"""FHIR provenance digests (already uses SHA-256 — quantum-resistant hashing)."""
import hashlib
import hmac


def provenance_digest(bundle_bytes):
    return hashlib.sha256(bundle_bytes).hexdigest()


def webhook_mac(secret, body):
    return hmac.new(secret, body, hashlib.sha256).hexdigest()
