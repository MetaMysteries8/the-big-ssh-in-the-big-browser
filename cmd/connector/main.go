package main

import (
	"os"

	"github.com/MetaMysteries8/the-big-ssh-in-the-big-browser/internal/connector"
)

func main() {
	// stdout belongs exclusively to the browser's framed native-messaging stream.
	if err := connector.Serve(os.Stdin, os.Stdout, connector.Options{
		LoopbackOnly: os.Getenv("BIGSSH_TEST_LOOPBACK_ONLY") == "1",
	}); err != nil {
		os.Exit(1)
	}
}
