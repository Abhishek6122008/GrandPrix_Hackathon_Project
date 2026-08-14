package com.crowdflow.security;

import com.crowdflow.model.AppUser;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Who is allowed to be an admin, as configured by {@code auth.admin-emails}.
 *
 * <p>One copy of this list, because there are three places that need it and they must agree:
 * {@code AuthController} applies it at registration and login, {@code AdminSeeder} creates the
 * accounts at boot, and {@link JwtAuthFilter} consults it when provisioning a federated user.
 * Three independent parses of the same comma-separated string is three chances to normalise it
 * differently, and the one that disagrees becomes the way in.
 *
 * <h2>Why the filter needs it</h2>
 *
 * ADMIN is deliberately not self-service: it cannot be requested at registration and cannot be
 * reached by signing in at the admin door. But a Supabase or Firebase token carries its own
 * {@code role} claim, and a federated account is provisioned from that claim on first sight —
 * so without {@link #clamp} an external token claiming ADMIN would mint a platform admin and
 * walk straight past the allowlist that governs everyone else.
 */
@Component
public class AdminAllowlist {

    private final Set<String> emails;

    public AdminAllowlist(@Value("${auth.admin-emails:}") String adminEmails) {
        this.emails = Arrays.stream((adminEmails == null ? "" : adminEmails).split(","))
                .map(AdminAllowlist::normalise)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }

    public boolean contains(String email) {
        return email != null && emails.contains(normalise(email));
    }

    public boolean isEmpty() {
        return emails.isEmpty();
    }

    public int size() {
        return emails.size();
    }

    /** The configured addresses, for the seeder. */
    public List<String> emails() {
        return List.copyOf(emails);
    }

    /**
     * The role an externally-authenticated account may actually hold.
     *
     * <p>ADMIN survives only for an allowlisted address; anyone else claiming it lands on
     * CLIENT, which is the most capable role that is self-service anyway. Returning CLIENT
     * rather than refusing the token is deliberate — the signature is valid and the person is
     * real, so the right answer is to sign them in with the privileges they are entitled to,
     * not to lock out a legitimate user because their provider set an unexpected claim.
     */
    public AppUser.Role clamp(AppUser.Role claimed, String email) {
        if (claimed != AppUser.Role.ADMIN) return claimed;
        return contains(email) ? AppUser.Role.ADMIN : AppUser.Role.CLIENT;
    }

    static String normalise(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
