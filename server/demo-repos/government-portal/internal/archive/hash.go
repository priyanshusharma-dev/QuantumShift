// Package archive fingerprints archived citizen documents (DEMO SAMPLE).
package archive

import (
	"crypto/sha1"
	"encoding/hex"
)

// Fingerprint returns the legacy archive fingerprint of a document.
func Fingerprint(doc []byte) string {
	h := sha1.New()
	h.Write(doc)
	return hex.EncodeToString(h.Sum(nil))
}
