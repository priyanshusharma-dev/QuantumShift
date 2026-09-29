"""Legacy imaging archive integrity checks (DEMO SAMPLE)."""
import hashlib


def dicom_checksum(blob):
    return hashlib.sha1(blob).hexdigest()


def legacy_lab_result_hash(payload):
    return hashlib.md5(payload).hexdigest()
