// Package connector supplies one TCP stream per native messaging process.
// It does not implement SSH or receive authentication credentials.
package connector

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	Protocol   = 1
	MaxFrame   = 64 * 1024
	ChunkSize  = 32 * 1024
	WindowSize = 256 * 1024
)

type Message struct {
	Type     string `json:"type"`
	ID       int64  `json:"id,omitempty"`
	Protocol int    `json:"protocol,omitempty"`
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	Data     string `json:"data,omitempty"`
	Bytes    int    `json:"bytes,omitempty"`
}

type Options struct {
	// Only the local automated test harness sets this. Resolve no remote names.
	LoopbackOnly bool
	Dial         func(context.Context, string, string) (net.Conn, error)
}

type host struct {
	ctx     context.Context
	cancel  context.CancelFunc
	writer  io.Writer
	writeMu sync.Mutex
	mu      sync.Mutex
	conn    net.Conn
	started bool
	busy    bool
	credit  int
	wake    chan struct{}
	options Options
}

func ReadMessage(r io.Reader) (Message, error) {
	var size [4]byte
	if _, err := io.ReadFull(r, size[:]); err != nil {
		return Message{}, err
	}
	n := binary.LittleEndian.Uint32(size[:])
	if n == 0 || n > MaxFrame {
		return Message{}, errors.New("invalid native message size")
	}
	data := make([]byte, n)
	if _, err := io.ReadFull(r, data); err != nil {
		return Message{}, err
	}
	var msg Message
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&msg); err != nil {
		return msg, errors.New("invalid native message")
	}
	if dec.Decode(new(any)) != io.EOF {
		return msg, errors.New("trailing native message data")
	}
	return msg, nil
}

func WriteMessage(w io.Writer, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(data) > MaxFrame {
		return errors.New("native message too large")
	}
	var size [4]byte
	binary.LittleEndian.PutUint32(size[:], uint32(len(data)))
	if err = writeAll(w, size[:]); err != nil {
		return err
	}
	return writeAll(w, data)
}

func writeAll(w io.Writer, data []byte) error {
	for len(data) > 0 {
		n, err := w.Write(data)
		if err != nil {
			return err
		}
		if n <= 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}

func ValidateTarget(hostname string, port int, loopbackOnly bool) error {
	if hostname == "" || len(hostname) > 253 || strings.TrimSpace(hostname) != hostname || strings.ContainsAny(hostname, "/\\@\x00\r\n\t ") {
		return errors.New("invalid hostname")
	}
	if port < 1 || port > 65535 {
		return errors.New("invalid port")
	}
	if strings.Contains(hostname, ":") && net.ParseIP(hostname) == nil {
		return errors.New("invalid IP address")
	}
	if loopbackOnly {
		ip := net.ParseIP(hostname)
		if hostname != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return errors.New("test mode permits only loopback targets")
		}
	}
	return nil
}

func Serve(r io.Reader, w io.Writer, options Options) error {
	ctx, cancel := context.WithCancel(context.Background())
	h := &host{ctx: ctx, cancel: cancel, writer: w, wake: make(chan struct{}, 1), options: options}
	defer h.stop()
	if options.Dial == nil {
		dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
		h.options.Dial = dialer.DialContext
	}
	hello, err := ReadMessage(r)
	if err != nil {
		return err
	}
	if hello.Type != "hello" || hello.Protocol != Protocol {
		_ = h.send(map[string]any{"type": "error", "message": "unsupported connector protocol"})
		return errors.New("unsupported protocol")
	}
	if err := h.send(map[string]any{"type": "ready", "protocol": Protocol, "version": "0.1.0", "window": WindowSize, "chunkSize": ChunkSize}); err != nil {
		return err
	}
	for {
		msg, err := ReadMessage(r)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		switch msg.Type {
		case "open":
			if err := ValidateTarget(msg.Host, msg.Port, options.LoopbackOnly); err != nil {
				h.fail(msg.ID, err.Error())
				continue
			}
			h.mu.Lock()
			if h.started {
				h.mu.Unlock()
				h.fail(msg.ID, "one connection per connector process")
				continue
			}
			h.started = true
			h.mu.Unlock()
			go h.open(msg)
		case "credit":
			h.mu.Lock()
			if msg.Bytes <= 0 || msg.Bytes > WindowSize || h.credit > WindowSize-msg.Bytes {
				h.mu.Unlock()
				h.fail(msg.ID, "invalid read credit")
				return errors.New("invalid credit")
			}
			h.credit += msg.Bytes
			h.mu.Unlock()
			select {
			case h.wake <- struct{}{}:
			default:
			}
		case "write":
			data, err := base64.StdEncoding.Strict().DecodeString(msg.Data)
			if err != nil || len(data) == 0 || len(data) > ChunkSize {
				h.fail(msg.ID, "invalid data chunk")
				continue
			}
			h.mu.Lock()
			if h.conn == nil || h.busy {
				h.mu.Unlock()
				h.fail(msg.ID, "socket unavailable or write already pending")
				continue
			}
			conn := h.conn
			h.busy = true
			h.mu.Unlock()
			go h.write(conn, msg.ID, data)
		case "close":
			h.stop()
			return h.send(map[string]any{"type": "closed", "id": msg.ID})
		default:
			h.fail(msg.ID, "unsupported operation")
		}
	}
}

func (h *host) send(event any) error {
	h.writeMu.Lock()
	defer h.writeMu.Unlock()
	return WriteMessage(h.writer, event)
}

func (h *host) fail(id int64, message string) {
	_ = h.send(map[string]any{"type": "error", "id": id, "message": message})
}

func (h *host) stop() {
	h.cancel()
	h.mu.Lock()
	if h.conn != nil {
		_ = h.conn.Close()
		h.conn = nil
	}
	h.mu.Unlock()
}

func (h *host) open(msg Message) {
	hostname := msg.Host
	if h.options.LoopbackOnly && hostname == "localhost" {
		hostname = "127.0.0.1"
	}
	conn, err := h.options.Dial(h.ctx, "tcp", net.JoinHostPort(hostname, strconv.Itoa(msg.Port)))
	if err != nil {
		if h.ctx.Err() != nil {
			return
		}
		h.fail(msg.ID, fmt.Sprintf("TCP connection failed: %v", err))
		return
	}
	h.mu.Lock()
	if h.ctx.Err() != nil {
		h.mu.Unlock()
		_ = conn.Close()
		return
	}
	h.conn = conn
	h.mu.Unlock()
	if err := h.send(map[string]any{"type": "opened", "id": msg.ID, "localAddress": conn.LocalAddr().String(), "remoteAddress": conn.RemoteAddr().String()}); err != nil {
		h.stop()
		return
	}
	buffer := make([]byte, ChunkSize)
	for {
		h.mu.Lock()
		n := min(h.credit, ChunkSize)
		h.mu.Unlock()
		if n == 0 {
			select {
			case <-h.ctx.Done():
				return
			case <-h.wake:
				continue
			}
		}
		read, err := conn.Read(buffer[:n])
		if read > 0 {
			h.mu.Lock()
			h.credit -= read
			h.mu.Unlock()
			if sendErr := h.send(map[string]any{"type": "data", "data": base64.StdEncoding.EncodeToString(buffer[:read])}); sendErr != nil {
				h.stop()
				return
			}
		}
		if err != nil {
			if h.ctx.Err() == nil {
				_ = h.send(map[string]any{"type": "eof"})
			}
			h.stop()
			return
		}
	}
}

func (h *host) write(conn net.Conn, id int64, data []byte) {
	_ = conn.SetWriteDeadline(time.Now().Add(15 * time.Second))
	err := writeAll(conn, data)
	h.mu.Lock()
	h.busy = false
	h.mu.Unlock()
	if err != nil {
		h.fail(id, "TCP write failed")
		h.stop()
		return
	}
	_ = h.send(map[string]any{"type": "written", "id": id, "bytes": len(data)})
}
