// Package tlsserver configures the public citizen portal TLS endpoint (DEMO SAMPLE).
package tlsserver

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
)

// NewServerKey generates the RSA key used for the portal certificate.
func NewServerKey() (*rsa.PrivateKey, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	return key, err
}

// Config returns the TLS configuration for the citizen portal.
func Config(cert tls.Certificate) *tls.Config {
	return &tls.Config{
		Certificates:     []tls.Certificate{cert},
		MinVersion:       tls.VersionTLS12,
		CurvePreferences: []tls.CurveID{tls.CurveP256, tls.X25519},
	}
}
