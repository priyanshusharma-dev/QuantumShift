package com.legacy.security;

import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/** Legacy crypto utilities used by the HR batch jobs (DEMO SAMPLE — no real secrets). */
public class LegacyCrypto {

    private static final String MASTER_KEY = "DEMO-HARDCODED-KEY-0000";

    public byte[] encryptEmployeeRecord(byte[] record, byte[] key) throws Exception {
        Cipher cipher = Cipher.getInstance("DESede/CBC/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "DESede"));
        return cipher.doFinal(record);
    }

    public byte[] passwordHash(byte[] password) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        return md.digest(password);
    }

    public byte[] reportChecksum(byte[] report) throws Exception {
        MessageDigest md = MessageDigest.getInstance("MD5");
        return md.digest(report);
    }
}
