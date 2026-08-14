// In the security package, not alongside the other tests, so that JwtService.DEV_SECRET can
// stay package-private. A constant naming the insecure default should not be part of the
// public surface just to be assertable.
package com.crowdflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.crowdflow.model.AppUser;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/**
 * Two guards that decide who may hold ADMIN, asserted directly.
 *
 * Plain unit tests with no Spring context: each is a pure decision, and the point of pinning
 * them is that this is the kind of check that gets written once, quietly stops being wired up,
 * and is never noticed again — which is exactly what had happened to
 * {@link JwtService#assertProductionSecret} before it was called from the constructor.
 */
class AuthHardeningTest {

    private static JwtService jwtServiceOn(String secret, String... profiles) {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles(profiles);
        return new JwtService(secret, 720, "crowd-flow-optimiser", env);
    }

    // --- the dev JWT secret must not reach a deployment ----------------------

    @Test
    void theCloudProfileRefusesToStartOnTheDevelopmentSecret() {
        // The secret is in a public repository, so booting on it means anyone reading the
        // source can mint a token for any account, including an admin one.
        assertThatThrownBy(() -> jwtServiceOn(JwtService.DEV_SECRET, "cloud"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("AUTH_JWT_SECRET");
    }

    @Test
    void theCloudProfileAlsoRefusesASecretTooShortToBeOne() {
        // Padding keeps local dev working but invents no entropy: a short secret padded to 32
        // bytes is still a short secret.
        assertThatThrownBy(() -> jwtServiceOn("short-secret", "cloud"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void localDevelopmentStillBootsOnIt() {
        assertThatCode(() -> jwtServiceOn(JwtService.DEV_SECRET)).doesNotThrowAnyException();
    }

    @Test
    void aRealSecretIsAcceptedUnderCloud() {
        assertThatCode(() -> jwtServiceOn("a-real-deployment-secret-of-adequate-length", "cloud"))
                .doesNotThrowAnyException();
    }

    // --- ADMIN is never granted by a token claim -----------------------------

    @Test
    void anExternalTokenCannotClaimItsWayToAdmin() {
        AdminAllowlist allowlist = new AdminAllowlist("ops@crowdflow.local");

        // A Supabase or Firebase project sets app_metadata.role itself. That makes it the
        // provider's opinion about their own product, not a grant of this platform's console.
        assertThat(allowlist.clamp(AppUser.Role.ADMIN, "stranger@example.com"))
                .isEqualTo(AppUser.Role.CLIENT);
    }

    @Test
    void anAllowlistedAddressKeepsAdminHoweverItSignedIn() {
        AdminAllowlist allowlist = new AdminAllowlist("ops@crowdflow.local");

        assertThat(allowlist.clamp(AppUser.Role.ADMIN, "OPS@Crowdflow.Local"))
                .isEqualTo(AppUser.Role.ADMIN);
    }

    @Test
    void everyOtherRolePassesThroughUntouched() {
        AdminAllowlist allowlist = new AdminAllowlist("ops@crowdflow.local");

        assertThat(allowlist.clamp(AppUser.Role.WALKER, "someone@example.com"))
                .isEqualTo(AppUser.Role.WALKER);
        assertThat(allowlist.clamp(AppUser.Role.CLIENT, null))
                .isEqualTo(AppUser.Role.CLIENT);
    }

    @Test
    void anEmptyAllowlistGrantsNobodyTheConsole() {
        assertThat(new AdminAllowlist("").clamp(AppUser.Role.ADMIN, "anyone@example.com"))
                .isEqualTo(AppUser.Role.CLIENT);
    }
}
