"""Patient record encryption (DEMO SAMPLE — intentionally quantum-vulnerable)."""
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes


def generate_record_keypair():
    """Key pair used to wrap per-record data keys (PHI retained 25+ years)."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


def wrap_data_key(public_key, data_key):
    return public_key.encrypt(
        data_key,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )


def encrypt_record(record_bytes):
    """Encrypts a FHIR bundle with a fresh data key."""
    data_key = get_random_bytes(16)
    cipher = AES.new(data_key, AES.MODE_CBC)
    padded = record_bytes + b" " * (16 - len(record_bytes) % 16)
    return data_key, cipher.iv, cipher.encrypt(padded)
