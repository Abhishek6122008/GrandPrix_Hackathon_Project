package com.crowdflow.config;

import com.crowdflow.repository.UserRepository;
import com.crowdflow.security.JwtAuthFilter;
import com.crowdflow.security.TokenVerifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * Who may call what.
 *
 * The API is stateless: there is no HTTP session and no CSRF token, because every call is
 * authorised by a bearer token that a browser will not attach automatically. CSRF protection
 * exists to defend cookie-based auth, so leaving it on here would break clients without
 * adding protection.
 *
 * The rules are deliberately coarse — reads are open, writes need a role — because the venue
 * map and the marketing pages are meant to be viewable without an account, while anything
 * that starts a simulation or changes a venue is not.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;

    public SecurityConfig(java.util.List<TokenVerifier> verifiers, UserRepository users) {
        this.jwtAuthFilter = new JwtAuthFilter(verifiers, users);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        // Cost 10 is the Spring default: ~50ms per hash, which is slow enough to make offline
        // cracking expensive and fast enough not to be a login bottleneck.
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(cors -> { })  // honours the existing CorsConfig WebMvcConfigurer
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // --- open ---------------------------------------------------------------
                .requestMatchers("/auth/**", "/health", "/actuator/**").permitAll()
                // The WebSocket carries its own session id in the URL and is authorised by
                // the handler; the handshake itself cannot send an Authorization header.
                .requestMatchers("/ws/**").permitAll()
                // Reading a venue or watching a running session is public: the live map on the
                // marketing pages has no signed-in user behind it.
                .requestMatchers(HttpMethod.GET, "/venues/**", "/sessions/**", "/simulations/**", "/alerts/**").permitAll()
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()

                // --- writes -------------------------------------------------------------
                // Creating and driving a run is an organiser action; admins can do it too.
                .requestMatchers("/sessions/**", "/simulations/**").hasAnyRole("CLIENT", "ADMIN")
                .requestMatchers("/venues/**").hasAnyRole("CLIENT", "ADMIN")

                .anyRequest().authenticated())
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
            // Fail as a JSON API, not as a browser login prompt.
            //
            // The default entry point answers 401 with a WWW-Authenticate challenge, which is
            // meant for HTTP Basic. On a fetch client it makes the browser pop its own
            // credential dialog, and on JDK HTTP clients it triggers a re-authentication retry
            // that fails outright on a streamed body. Neither is useful when the caller is
            // supposed to send a bearer token, so the challenge is dropped.
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint((request, response, authException) -> {
                    response.setStatus(HttpStatus.UNAUTHORIZED.value());
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    response.getWriter().write("{\"message\":\"Authentication required\"}");
                })
                .accessDeniedHandler((request, response, denied) -> {
                    response.setStatus(HttpStatus.FORBIDDEN.value());
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    response.getWriter().write("{\"message\":\"You do not have access to this resource\"}");
                }));

        return http.build();
    }
}
