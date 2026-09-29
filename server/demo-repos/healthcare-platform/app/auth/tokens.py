"""Clinician session tokens (DEMO SAMPLE)."""
import jwt
from cryptography.hazmat.primitives.asymmetric import ec


def generate_clinician_signing_key():
    return ec.generate_private_key(ec.SECP256R1())


def issue_clinician_token(claims, signing_key):
    return jwt.encode(claims, signing_key, algorithm="ES256")
