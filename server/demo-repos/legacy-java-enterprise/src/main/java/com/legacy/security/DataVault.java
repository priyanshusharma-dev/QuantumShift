package com.legacy.security;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/** Newer data vault (already quantum-resistant: AES-256-GCM). */
public class DataVault {

    public SecretKey newVaultKey() throws Exception {
        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(256);
        return keyGen.generateKey();
    }

    public Cipher vaultCipher() throws Exception {
        return Cipher.getInstance("AES/GCM/NoPadding");
    }
}
