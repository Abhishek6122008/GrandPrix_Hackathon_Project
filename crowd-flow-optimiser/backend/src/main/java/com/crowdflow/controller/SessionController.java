package com.crowdflow.controller;

import com.crowdflow.dto.CreateSessionRequest;
import com.crowdflow.dto.SessionInfo;
import com.crowdflow.dto.SessionState;
import com.crowdflow.model.Session;
import com.crowdflow.service.session.SessionManager;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The session API: upload a venue and get a running crowd simulation.
 *
 * <pre>
 *   POST /sessions              venue JSON + crowd settings -> session
 *   POST /sessions/{id}/start   begin (or resume) ticking
 *   POST /sessions/{id}/pause   hold the clock, keep the state
 *   POST /sessions/{id}/stop    terminal; numbers are final
 *   GET  /sessions/{id}         session info
 *   GET  /sessions/{id}/state   the latest broadcast frame, for clients without a socket
 *   WS   /sessions/{id}/stream  live frames (see SessionSocketHandler)
 * </pre>
 */
@RestController
@RequestMapping("/sessions")
public class SessionController {

    private final SessionManager sessions;

    public SessionController(SessionManager sessions) {
        this.sessions = sessions;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SessionInfo create(@Valid @RequestBody CreateSessionRequest request) {
        Session session = sessions.create(request);
        return SessionInfo.of(session, sessions.viewerCount(session.getId()));
    }

    @PostMapping("/{id}/start")
    public SessionInfo start(@PathVariable String id) {
        return info(sessions.start(id));
    }

    @PostMapping("/{id}/pause")
    public SessionInfo pause(@PathVariable String id) {
        return info(sessions.pause(id));
    }

    @PostMapping("/{id}/stop")
    public SessionInfo stop(@PathVariable String id) {
        return info(sessions.stop(id));
    }

    @GetMapping("/{id}")
    public SessionInfo get(@PathVariable String id) {
        return info(sessions.get(id));
    }

    /**
     * The same frame the WebSocket pushes. Here so a client can poll, screenshot or assert on
     * the state without holding a socket open — which is exactly what the end-to-end check does.
     */
    @GetMapping("/{id}/state")
    public SessionState state(@PathVariable String id) {
        return sessions.get(id).getLatestState();
    }

    private SessionInfo info(Session session) {
        return SessionInfo.of(session, sessions.viewerCount(session.getId()));
    }
}
