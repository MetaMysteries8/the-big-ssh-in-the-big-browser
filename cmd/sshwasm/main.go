//go:build js && wasm

package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"syscall/js"
	"time"

	"golang.org/x/crypto/ssh"
)

type config struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	Auth       string `json:"auth"`
	Password   string `json:"password"`
	PrivateKey string `json:"privateKey"`
	Passphrase string `json:"passphrase"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
}

type streamConn struct {
	transport js.Value
	readMu    sync.Mutex
	writeMu   sync.Mutex
	buffer    []byte
	once      sync.Once
}

func await(value js.Value) (js.Value, error) {
	type result struct {
		value js.Value
		err   error
	}
	ch := make(chan result, 1)
	resolve := js.FuncOf(func(_ js.Value, args []js.Value) any {
		v := js.Undefined()
		if len(args) > 0 {
			v = args[0]
		}
		ch <- result{value: v}
		return nil
	})
	reject := js.FuncOf(func(_ js.Value, args []js.Value) any {
		message := "operation failed"
		if len(args) > 0 {
			if args[0].Type() == js.TypeString {
				message = args[0].String()
			} else if args[0].Type() == js.TypeObject {
				message = args[0].Get("message").String()
			}
		}
		ch <- result{err: errors.New(message)}
		return nil
	})
	js.Global().Get("Promise").Call("resolve", value).Call("then", resolve, reject)
	r := <-ch
	resolve.Release()
	reject.Release()
	return r.value, r.err
}

func promise(fn func() (any, error)) any {
	executor := js.FuncOf(func(_ js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			value, err := fn()
			if err != nil {
				reject.Invoke(js.Global().Get("Error").New(err.Error()))
				return
			}
			resolve.Invoke(value)
		}()
		return nil
	})
	p := js.Global().Get("Promise").New(executor)
	executor.Release()
	return p
}

func (c *streamConn) Read(p []byte) (int, error) {
	c.readMu.Lock()
	defer c.readMu.Unlock()
	if len(c.buffer) == 0 {
		value, err := await(c.transport.Call("read"))
		if err != nil {
			return 0, err
		}
		if value.IsNull() || value.IsUndefined() {
			return 0, io.EOF
		}
		c.buffer = make([]byte, value.Get("byteLength").Int())
		js.CopyBytesToGo(c.buffer, value)
	}
	n := copy(p, c.buffer)
	c.buffer = c.buffer[n:]
	return n, nil
}

func (c *streamConn) Write(p []byte) (int, error) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	value := js.Global().Get("Uint8Array").New(len(p))
	js.CopyBytesToJS(value, p)
	if _, err := await(c.transport.Call("write", value)); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (c *streamConn) Close() error { c.once.Do(func() { c.transport.Call("close") }); return nil }

type addr string

func (a addr) Network() string                         { return "browser-transport" }
func (a addr) String() string                          { return string(a) }
func (c *streamConn) LocalAddr() net.Addr              { return addr("local-connector") }
func (c *streamConn) RemoteAddr() net.Addr             { return addr("selected-ssh-target") }
func (c *streamConn) SetDeadline(time.Time) error      { return nil }
func (c *streamConn) SetReadDeadline(time.Time) error  { return nil }
func (c *streamConn) SetWriteDeadline(time.Time) error { return nil }

type connection struct {
	done      chan struct{}
	conn      *streamConn
	client    *ssh.Client
	session   *ssh.Session
	stdin     io.WriteCloser
	callbacks js.Value
}

var activeMu sync.Mutex
var active *connection
var exports []js.Func

func (c *connection) output(reader io.Reader, wg *sync.WaitGroup) {
	defer wg.Done()
	buffer := make([]byte, 16*1024)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			chunk := js.Global().Get("Uint8Array").New(n)
			js.CopyBytesToJS(chunk, buffer[:n])
			if _, writeErr := await(c.callbacks.Call("output", chunk)); writeErr != nil {
				_ = c.client.Close()
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func connect(options, transport, callbacks js.Value) (any, error) {
	var cfg config
	if err := json.Unmarshal([]byte(js.Global().Get("JSON").Call("stringify", options).String()), &cfg); err != nil {
		return nil, err
	}
	if cfg.Host == "" || cfg.Username == "" || cfg.Port < 1 || cfg.Port > 65535 {
		return nil, errors.New("host, port, and username are required")
	}
	c := &connection{conn: &streamConn{transport: transport}, callbacks: callbacks, done: make(chan struct{})}
	activeMu.Lock()
	if active != nil {
		activeMu.Unlock()
		return nil, errors.New("a session is already active")
	}
	active = c
	activeMu.Unlock()
	success := false
	defer func() {
		if !success {
			_ = c.conn.Close()
			activeMu.Lock()
			if active == c {
				active = nil
			}
			activeMu.Unlock()
			close(c.done)
		}
	}()
	auth := []ssh.AuthMethod{}
	switch cfg.Auth {
	case "key":
		var signer ssh.Signer
		var err error
		if cfg.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(cfg.PrivateKey), []byte(cfg.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(cfg.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("cannot read private key: %w", err)
		}
		auth = append(auth, ssh.PublicKeys(signer))
	case "password":
		auth = append(auth, ssh.Password(cfg.Password))
	case "keyboard", "none":
	default:
		return nil, errors.New("unsupported authentication method")
	}
	auth = append(auth, ssh.KeyboardInteractive(func(name, instruction string, questions []string, echos []bool) ([]string, error) {
		items := make([]any, len(questions))
		for i, q := range questions {
			items[i] = map[string]any{"question": q, "echo": echos[i]}
		}
		value, err := await(callbacks.Call("prompt", map[string]any{"name": name, "instruction": instruction, "questions": items}))
		if err != nil {
			return nil, err
		}
		if value.Length() != len(questions) {
			return nil, errors.New("authentication prompt cancelled")
		}
		answers := make([]string, len(questions))
		for i := range answers {
			answers[i] = value.Index(i).String()
		}
		return answers, nil
	}))
	clientConfig := &ssh.ClientConfig{
		User: cfg.Username, Auth: auth,
		HostKeyCallback: func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			value, err := await(callbacks.Call("verifyHostKey", map[string]any{"host": cfg.Host, "port": cfg.Port, "algorithm": key.Type(), "fingerprint": ssh.FingerprintSHA256(key)}))
			if err != nil {
				return err
			}
			if !value.Bool() {
				return errors.New("host key was not trusted")
			}
			return nil
		},
		BannerCallback: func(message string) error {
			chunk := js.Global().Get("Uint8Array").New(len(message))
			js.CopyBytesToJS(chunk, []byte(message))
			_, err := await(callbacks.Call("output", chunk))
			return err
		},
		ClientVersion: "SSH-2.0-BigSSH_0.1",
	}
	callbacks.Call("state", "negotiating")
	deadline := time.AfterFunc(2*time.Minute, func() { _ = c.conn.Close() })
	clientConn, channels, requests, err := ssh.NewClientConn(c.conn, net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)), clientConfig)
	deadline.Stop()
	if err != nil {
		return nil, fmt.Errorf("SSH negotiation failed: %w", err)
	}
	c.client = ssh.NewClient(clientConn, channels, requests)
	c.session, err = c.client.NewSession()
	if err != nil {
		_ = c.client.Close()
		return nil, err
	}
	c.stdin, err = c.session.StdinPipe()
	if err != nil {
		_ = c.client.Close()
		return nil, err
	}
	stdout, err := c.session.StdoutPipe()
	if err != nil {
		_ = c.client.Close()
		return nil, err
	}
	stderr, err := c.session.StderrPipe()
	if err != nil {
		_ = c.client.Close()
		return nil, err
	}
	if err = c.session.RequestPty("xterm-256color", max(cfg.Rows, 1), max(cfg.Cols, 1), ssh.TerminalModes{}); err != nil {
		_ = c.client.Close()
		return nil, err
	}
	var outputWG sync.WaitGroup
	outputWG.Add(2)
	go c.output(stdout, &outputWG)
	go c.output(stderr, &outputWG)
	if err = c.session.Shell(); err != nil {
		_ = c.client.Close()
		return nil, err
	}
	success = true
	callbacks.Call("state", "connected")
	go func() {
		err := c.session.Wait()
		outputWG.Wait()
		_ = c.client.Close()
		_ = c.conn.Close()
		activeMu.Lock()
		if active == c {
			active = nil
		}
		activeMu.Unlock()
		close(c.done)
		message := "Session closed"
		if err != nil {
			message = err.Error()
		}
		callbacks.Call("closed", message)
	}()
	return map[string]any{"host": cfg.Host, "username": cfg.Username}, nil
}

func export(name string, callback func(js.Value, []js.Value) any) {
	f := js.FuncOf(callback)
	exports = append(exports, f)
	js.Global().Get("BigSSH").Set(name, f)
}

func main() {
	js.Global().Set("BigSSH", js.Global().Get("Object").New())
	export("connect", func(_ js.Value, args []js.Value) any {
		if len(args) != 3 {
			return promise(func() (any, error) { return nil, errors.New("invalid connect arguments") })
		}
		return promise(func() (any, error) { return connect(args[0], args[1], args[2]) })
	})
	export("input", func(_ js.Value, args []js.Value) any {
		data := args[0].String()
		return promise(func() (any, error) {
			activeMu.Lock()
			c := active
			activeMu.Unlock()
			if c == nil || c.stdin == nil {
				return nil, errors.New("not connected")
			}
			_, err := io.Copy(c.stdin, bytes.NewBufferString(data))
			return nil, err
		})
	})
	export("resize", func(_ js.Value, args []js.Value) any {
		cols, rows := args[0].Int(), args[1].Int()
		return promise(func() (any, error) {
			activeMu.Lock()
			c := active
			activeMu.Unlock()
			if c == nil || c.session == nil {
				return nil, nil
			}
			return nil, c.session.WindowChange(max(rows, 1), max(cols, 1))
		})
	})
	export("close", func(_ js.Value, _ []js.Value) any {
		activeMu.Lock()
		c := active
		activeMu.Unlock()
		return promise(func() (any, error) {
			if c != nil {
				_ = c.conn.Close()
				<-c.done
			}
			return nil, nil
		})
	})
	export("generateKey", func(_ js.Value, _ []js.Value) any {
		return promise(func() (any, error) {
			_, key, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				return nil, err
			}
			block, err := ssh.MarshalPrivateKey(key, "bigssh-browser")
			if err != nil {
				return nil, err
			}
			pub, err := ssh.NewPublicKey(key.Public())
			if err != nil {
				return nil, err
			}
			return map[string]any{"privateKey": string(pem.EncodeToMemory(block)), "publicKey": string(ssh.MarshalAuthorizedKey(pub))}, nil
		})
	})
	select {}
}
