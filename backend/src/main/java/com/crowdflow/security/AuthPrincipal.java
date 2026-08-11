package com.crowdflow.security;

import com.crowdflow.model.AppUser;

/** Who a verified token belongs to, independent of which system minted it. */
public record AuthPrincipal(String userId, String email, AppUser.Role role, String provider) { }
