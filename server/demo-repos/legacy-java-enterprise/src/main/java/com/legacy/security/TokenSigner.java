package com.legacy.security;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.Signature;

/** Signs SSO assertions for the HR portal (DEMO SAMPLE). */
public class TokenSigner {

    public KeyPair generateSigningKey() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("EC");
        kpg.initialize(256);
        return kpg.generateKeyPair();
    }

    public byte[] signAssertion(PrivateKey key, byte[] assertion) throws Exception {
        Signature signature = Signature.getInstance("SHA256withECDSA");
        signature.initSign(key);
        signature.update(assertion);
        return signature.sign();
    }
}
