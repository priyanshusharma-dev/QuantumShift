package com.legacy.security;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PublicKey;
import javax.crypto.Cipher;

/** Payroll document key management (DEMO SAMPLE — intentionally quantum-vulnerable). */
public class KeyManager {

    public KeyPair generatePayrollKeyPair() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(1024);
        return kpg.generateKeyPair();
    }

    public byte[] wrapPayrollKey(PublicKey publicKey, byte[] dataKey) throws Exception {
        Cipher cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding");
        cipher.init(Cipher.ENCRYPT_MODE, publicKey);
        return cipher.doFinal(dataKey);
    }
}
