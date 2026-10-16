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
	"testing"
	"time"
)

func TestFramingRejectsInvalidInput(t *testing.T) {
	for _, size := range []uint32{0, MaxFrame + 1} {
		var prefix [4]byte
		binary.LittleEndian.PutUint32(prefix[:], size)
		if _, err := ReadMessage(bytes.NewReader(prefix[:])); err == nil {
			t.Fatalf("accepted frame size %d", size)
		}
	}
	for _, body := range []string{`{"type":"hello","protocol":1,"command":"run"}`, `{"type":"hello"} {"type":"open"}`} {
		var input bytes.Buffer
		var size [4]byte
		binary.LittleEndian.PutUint32(size[:], uint32(len(body)))
		input.Write(size[:])
		input.WriteString(body)
		if _, err := ReadMessage(&input); err == nil {
			t.Fatalf("accepted malformed message: %s", body)
		}
	}
	if _, err := ReadMessage(bytes.NewReader([]byte{8, 0, 0, 0, '{'})); err == nil {
		t.Fatal("accepted truncated frame")
	}
}

type shortWriter struct{ bytes.Buffer }

func (w *shortWriter) Write(p []byte) (int, error) {
	if len(p) > 3 {
		p = p[:3]
	}
	return w.Buffer.Write(p)
}

func TestFramingHandlesPartialWrites(t *testing.T) {
	var writer shortWriter
	if err := WriteMessage(&writer, Message{Type: "hello", Protocol: 1}); err != nil {
		t.Fatal(err)
	}
	msg, err := ReadMessage(&writer.Buffer)
	if err != nil || msg.Type != "hello" || msg.Protocol != 1 {
		t.Fatalf("bad round trip: %#v %v", msg, err)
	}
}

func TestTargetValidationAndLiveTestIsolation(t *testing.T) {
	for _, hostname := range []string{"railway.new", "dev.new", "ssh.railway.com", "example.com", "127.0.0.1.example.com", "192.168.1.1"} {
		if ValidateTarget(hostname, 22, true) == nil {
			t.Fatalf("test mode accepted non-loopback %q", hostname)
		}
	}
	for _, hostname := range []string{"127.0.0.1", "::1", "localhost"} {
		if err := ValidateTarget(hostname, 2222, true); err != nil {
			t.Fatal(err)
		}
	}
	for _, hostname := range []string{"", "user@host", "ssh://host", "host\nother", "bad:port", " host"} {
		if ValidateTarget(hostname, 22, false) == nil {
			t.Fatalf("accepted %q", hostname)
		}
	}
	for _, port := range []int{0, -1, 65536} {
		if ValidateTarget("localhost", port, false) == nil {
			t.Fatalf("accepted port %d", port)
		}
	}
}

type peer struct {
	t      *testing.T
	in     *io.PipeWriter
	out    *io.PipeReader
	events chan map[string]any
	done   chan error
}

func newPeer(t *testing.T, options Options) *peer {
	t.Helper()
	input, in := io.Pipe()
	out, output := io.Pipe()
	p := &peer{t: t, in: in, out: out, events: make(chan map[string]any, 16), done: make(chan error, 1)}
	go func() { p.done <- Serve(input, output, options); _ = output.Close() }()
	go func() {
		defer close(p.events)
		for {
			var size [4]byte
			if _, err := io.ReadFull(out, size[:]); err != nil {
				return
			}
			n := binary.LittleEndian.Uint32(size[:])
			if n > MaxFrame {
				return
			}
			data := make([]byte, n)
			if _, err := io.ReadFull(out, data); err != nil {
				return
			}
			var event map[string]any
			if json.Unmarshal(data, &event) != nil {
				return
			}
			p.events <- event
		}
	}()
	t.Cleanup(func() { _ = in.Close(); _ = out.Close() })
	return p
}

func (p *peer) send(msg Message) {
	p.t.Helper()
	if err := WriteMessage(p.in, msg); err != nil {
		p.t.Fatal(err)
	}
}
func (p *peer) event(expected string) map[string]any {
	p.t.Helper()
	select {
	case event, ok := <-p.events:
		if !ok || event["type"] != expected {
			p.t.Fatalf("wanted %s, received %#v", expected, event)
		}
		return event
	case <-time.After(3 * time.Second):
		p.t.Fatalf("timed out waiting for %s", expected)
	}
	return nil
}
func (p *peer) hello() { p.send(Message{Type: "hello", Protocol: Protocol}); p.event("ready") }

func TestTCPRoundTripAndSourceAddress(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	remote := make(chan net.Addr, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		remote <- conn.RemoteAddr()
		_, _ = io.Copy(conn, conn)
	}()
	p := newPeer(t, Options{LoopbackOnly: true})
	p.hello()
	_, portText, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portText)
	p.send(Message{Type: "open", ID: 1, Host: "127.0.0.1", Port: port})
	opened := p.event("opened")
	select {
	case addr := <-remote:
		if opened["localAddress"] != addr.String() {
			t.Fatalf("server observed %s, connector reports %s", addr, opened["localAddress"])
		}
	case <-time.After(time.Second):
		t.Fatal("no accepted connection")
	}
	p.send(Message{Type: "credit", Bytes: WindowSize})
	data := []byte{0, 1, 2, 127, 128, 254, 255, 'S', 'S', 'H', '\n'}
	p.send(Message{Type: "write", ID: 2, Data: base64.StdEncoding.EncodeToString(data)})
	var received []byte
	ack := false
	for !ack || len(received) < len(data) {
		select {
		case event := <-p.events:
			switch event["type"] {
			case "written":
				ack = true
			case "data":
				chunk, err := base64.StdEncoding.DecodeString(event["data"].(string))
				if err != nil {
					t.Fatal(err)
				}
				received = append(received, chunk...)
			default:
				t.Fatalf("unexpected %#v", event)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("round trip timed out")
		}
	}
	if !bytes.Equal(data, received) {
		t.Fatalf("corrupted bytes: %v", received)
	}
	p.send(Message{Type: "close", ID: 3})
	p.event("closed")
	select {
	case err := <-p.done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("connector did not stop")
	}
}

func TestReadCreditBoundsSocketOutput(t *testing.T) {
	client, server := net.Pipe()
	defer server.Close()
	p := newPeer(t, Options{LoopbackOnly: true, Dial: func(context.Context, string, string) (net.Conn, error) { return client, nil }})
	p.hello()
	p.send(Message{Type: "open", ID: 1, Host: "127.0.0.1", Port: 2222})
	p.event("opened")
	go func() { _, _ = server.Write(bytes.Repeat([]byte{'x'}, 2048)) }()
	select {
	case event := <-p.events:
		t.Fatalf("data without credit: %#v", event)
	case <-time.After(30 * time.Millisecond):
	}
	p.send(Message{Type: "credit", Bytes: 1024})
	first := p.event("data")
	chunk, _ := base64.StdEncoding.DecodeString(first["data"].(string))
	if len(chunk) != 1024 {
		t.Fatalf("read beyond credit: %d", len(chunk))
	}
	select {
	case event := <-p.events:
		t.Fatalf("exceeded credit: %#v", event)
	case <-time.After(30 * time.Millisecond):
	}
	p.send(Message{Type: "credit", Bytes: 1024})
	p.event("data")
	p.send(Message{Type: "close"})
	p.event("closed")
}

func TestCloseCancelsPendingDial(t *testing.T) {
	dialStarted := make(chan struct{})
	cancelled := make(chan struct{})
	p := newPeer(t, Options{LoopbackOnly: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		close(dialStarted)
		<-ctx.Done()
		close(cancelled)
		return nil, ctx.Err()
	}})
	p.hello()
	p.send(Message{Type: "open", ID: 1, Host: "127.0.0.1", Port: 2222})
	select {
	case <-dialStarted:
	case <-time.After(time.Second):
		t.Fatal("dial not started")
	}
	p.send(Message{Type: "close"})
	p.event("closed")
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("dial not cancelled")
	}
}

func TestInvalidProtocolCannotDial(t *testing.T) {
	var input, output bytes.Buffer
	_ = WriteMessage(&input, Message{Type: "hello", Protocol: 999})
	called := false
	err := Serve(&input, &output, Options{Dial: func(context.Context, string, string) (net.Conn, error) {
		called = true
		return nil, errors.New("unexpected dial")
	}})
	if err == nil || called {
		t.Fatal("invalid protocol was accepted")
	}
}

func TestEOFClosesTheTCPConnection(t *testing.T) {
	client, server := net.Pipe()
	defer server.Close()
	p := newPeer(t, Options{LoopbackOnly: true, Dial: func(context.Context, string, string) (net.Conn, error) { return client, nil }})
	p.hello()
	p.send(Message{Type: "open", ID: 1, Host: "127.0.0.1", Port: 2222})
	p.event("opened")
	_ = p.in.Close()
	_ = server.SetReadDeadline(time.Now().Add(time.Second))
	var b [1]byte
	_, err := server.Read(b[:])
	if !errors.Is(err, io.EOF) {
		t.Fatalf("TCP not closed on browser EOF: %v", err)
	}
}

func TestCreditOverflowStopsTheConnector(t *testing.T) {
	for _, credits := range [][]int{{0}, {-1}, {WindowSize + 1}, {WindowSize, 1}} {
		t.Run(fmt.Sprint(credits), func(t *testing.T) {
			p := newPeer(t, Options{LoopbackOnly: true})
			p.hello()
			for _, credit := range credits {
				p.send(Message{Type: "credit", Bytes: credit})
			}
			p.event("error")
			select {
			case err := <-p.done:
				if err == nil {
					t.Fatal("invalid credit did not stop the connector")
				}
			case <-time.After(time.Second):
				t.Fatal("connector accepted excess credit")
			}
		})
	}
}
