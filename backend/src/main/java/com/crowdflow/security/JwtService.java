package com.crowdflow.security;

import com.crowdflow.model.AppUser;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;

/**
 * Mints and checks the tokens this backend issues itself.
 *
 * HS256 with a shared secret, because both the minting and the verifying happen in this one
 * service — an asymmetric key would add key distribution for no benefit here. Supabase and
 * Firebase tokens are *not* handled by this class; they have their own verifiers.
 *
 * The secret must be supplied in any deployed environment. The development default is a fixed
 * string that is deliberately obvious, and {@link #assertProductionSecret} refuses to start
 * with it under the cloud profile — a JWT secret that ships in source is the same as no auth.
 */
@Service
public class JwtService implements TokenVerifier {

    static final String DEV_SECRET = "dev-only-insecure-secret-change-me-in-any-real-deployment";

    private final SecretKey key;
    private final Duration ttl;
    private final String issuer;

    public JwtService(
            @Value("${auth.jwt.secret:" + DEV_SECRET + "}") String secret,
            @Value("${auth.jwt.ttl-minutes:720}") long ttlMinutes,
            @Value("${auth.jwt.issuer:crowd-flow-optimiser}") String issuer) {
        // HS256 needs >= 256 bits of key material; pad rather than fail so a short dev secret
        // is usable, while a real secret is used verbatim.
        byte[] raw = secret.getBytes(StandardCharsets.UTF_8);
        if (raw.length < 32) {
            byte[] padded = new byte[32];
            System.arraycopy(raw, 0, padded, 0, raw.length);
            for (int i = raw.length; i < 32; i++) padded[i] = (byte) ('x' + (i % 7));
            raw = padded;
        }
        this.key = Keys.hmacShaKeyFor(raw);
        this.ttl = Duration.ofMinutes(ttlMinutes);
        this.issuer = issuer;
    }

    public String mint(AppUser user) {
        Instant now = Instant.now();
        return Jwts.builder()
                .issuer(issuer)
                .subject(user.getId())
                .claim("email", user.getEmail())
                .claim("role", user.getRole().name())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(ttl)))
                .signWith(key)
                .compact();
    }

    public long ttlSeconds() { return ttl.toSeconds(); }

    @Override public String name() { return "LOCAL"; }
    @Override public boolean enabled() { return true; }

    @Override
    public Optional<AuthPrincipal> verify(String token) {
        try {
            Claims c = Jwts.parser().verifyWith(key).requireIssuer(issuer).build()
                    .parseSignedClaims(token).getPayload();
            return Optional.of(new AuthPrincipal(
                    c.getSubject(),
                    c.get("email", String.class),
                    AppUser.Role.valueOf(c.get("role", String.class)),
                    "LOCAL"));
        } catch (Exception ignored) {
            // Wrong signature, expired, or simply a token minted by Supabase/Firebase. All of
            // those mean "not mine", which the filter handles by trying the next verifier.
            return Optional.empty();
        }
    }

    /** Called at startup under the cloud profile. See SecurityConfig. */
    public static void assertProductionSecret(String secret, String activeProfiles) {
        if (DEV_SECRET.equals(secret) && activeProfiles.contains("cloud")) {
            throw new IllegalStateException(
                    "auth.jwt.secret is still the development default. Set AUTH_JWT_SECRET "
                    + "before running with the cloud profile.");
        }
    }
}
