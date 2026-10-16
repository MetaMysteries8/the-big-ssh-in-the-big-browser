// Native control for the prepared-endpoint experiment. This is not part of
// the app or connector. It can only dial the owned IPv4 loopback fixture and
// supplies no authentication credentials.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

func main() {
	version := flag.String("version", "SSH-2.0-BigSSH_Control", "Synthetic client identification")
	flag.Parse()
	if flag.NArg() != 0 || !strings.HasPrefix(*version, "SSH-2.0-") || strings.ContainsAny(*version, "\r\n\x00") || len(*version) > 250 {
		fmt.Fprintln(os.Stderr, "Invalid local control identification")
		os.Exit(2)
	}
	result := map[string]any{"outcome": "failed", "hostKeySeen": false, "authenticationReached": false, "authenticated": false}
	conn, err := net.DialTimeout("tcp4", "127.0.0.1:2225", 2*time.Second)
	if err == nil {
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		config := &ssh.ClientConfig{
			User: "bigssh_native_control", ClientVersion: *version,
			// Observe only this synthetic fixture's host key. No real accounts,
			// credentials, or production trust decisions enter this program.
			HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
				result["hostKeySeen"] = true
				result["fingerprint"] = ssh.FingerprintSHA256(key)
				return nil
			},
		}
		client, _, _, handshakeErr := ssh.NewClientConn(conn, "127.0.0.1:2225", config)
		err = handshakeErr
		if client != nil {
			result["authenticated"] = true
			_ = client.Close()
		}
		if result["hostKeySeen"] == true && (err == nil || strings.Contains(err.Error(), "unable to authenticate")) {
			result["authenticationReached"] = true
			result["outcome"] = "authentication-reached"
		}
	}
	if err != nil {
		result["error"] = err.Error()
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
	if result["authenticationReached"] != true {
		os.Exit(1)
	}
}
