// Package identity signs citizen identity assertions (DEMO SAMPLE).
package identity

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
)

// NewAssertionKey creates the key used to sign digital identity assertions.
func NewAssertionKey() (*ecdsa.PrivateKey, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	return priv, err
}

// SignAssertion signs a citizen identity assertion (valid for decades).
func SignAssertion(priv *ecdsa.PrivateKey, assertion []byte) ([]byte, error) {
	digest := sha256.Sum256(assertion)
	return ecdsa.SignASN1(rand.Reader, priv, digest[:])
}
