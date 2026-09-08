package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	canvaAuthorizeURL = "https://www.canva.com/api/oauth/authorize"

	pkceStateLifetime = 10 * time.Minute
)

type pendingCanvaAuth struct {
	CodeVerifier string
	CreatedAt    time.Time
}

var canvaAuthStore = struct {
	sync.Mutex
	values map[string]pendingCanvaAuth
}{
	values: make(map[string]pendingCanvaAuth),
}

// generateCodeVerifier creates a cryptographically random PKCE verifier.
//
// Canva requires the verifier to be between 43 and 128 characters.
// 96 random bytes encoded with Base64URL produces a valid verifier.
func generateCodeVerifier() (string, error) {
	b := make([]byte, 96)

	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate code verifier: %w", err)
	}

	return base64.RawURLEncoding.EncodeToString(b), nil
}

// generateCodeChallenge creates the S256 PKCE challenge:
//
// BASE64URL(SHA256(code_verifier))
func generateCodeChallenge(codeVerifier string) string {
	hash := sha256.Sum256([]byte(codeVerifier))

	return base64.RawURLEncoding.EncodeToString(hash[:])
}

// generateOAuthState creates a separate random state value.
//
// IMPORTANT:
// State must NOT contain the code_verifier.
func generateOAuthState() (string, error) {
	b := make([]byte, 32)

	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate oauth state: %w", err)
	}

	return base64.RawURLEncoding.EncodeToString(b), nil
}

// canvaAuthorize starts the Canva OAuth authorization flow.
func canvaAuthorize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	clientID := strings.TrimSpace(os.Getenv("CANVA_CLIENT_ID"))
	if clientID == "" {
		http.Error(w, "CANVA_CLIENT_ID is not configured", http.StatusInternalServerError)
		return
	}

	redirectURI := strings.TrimSpace(os.Getenv("CANVA_REDIRECT_URI"))
	if redirectURI == "" {
		redirectURI = "https://soc-11-automation.onrender.com/seatalk/callback"
	}

	scope := strings.TrimSpace(os.Getenv("CANVA_SCOPES"))
	if scope == "" {
		// Replace this with the scopes you actually enabled
		// in the Canva Developer Portal.
		scope = "asset:read"
	}

	codeVerifier, err := generateCodeVerifier()
	if err != nil {
		http.Error(w, "failed to generate PKCE verifier", http.StatusInternalServerError)
		return
	}

	codeChallenge := generateCodeChallenge(codeVerifier)

	state, err := generateOAuthState()
	if err != nil {
		http.Error(w, "failed to generate OAuth state", http.StatusInternalServerError)
		return
	}

	// Store the verifier on the server.
	//
	// The verifier is deliberately NOT placed in:
	// - the URL
	// - state
	// - the browser
	// - the response
	canvaAuthStore.Lock()
	canvaAuthStore.values[state] = pendingCanvaAuth{
		CodeVerifier: codeVerifier,
		CreatedAt:    time.Now(),
	}
	canvaAuthStore.Unlock()

	// Remove expired authorization attempts.
	cleanupCanvaAuthStore()

	params := url.Values{}
	params.Set("code_challenge", codeChallenge)
	params.Set("code_challenge_method", "S256")
	params.Set("scope", scope)
	params.Set("response_type", "code")
	params.Set("client_id", clientID)
	params.Set("state", state)
	params.Set("redirect_uri", redirectURI)

	authorizationURL := canvaAuthorizeURL + "?" + params.Encode()

	log.Printf("starting Canva OAuth authorization")
	log.Printf("Canva redirect URI: %s", redirectURI)
	log.Printf("Canva state generated successfully")
	log.Printf("Canva PKCE code challenge generated successfully")

	http.Redirect(w, r, authorizationURL, http.StatusFound)
}

// getAndDeleteCanvaAuth retrieves the verifier associated with a state.
//
// The state is single-use, so it is deleted immediately.
func getAndDeleteCanvaAuth(state string) (pendingCanvaAuth, bool) {
	canvaAuthStore.Lock()
	defer canvaAuthStore.Unlock()

	auth, ok := canvaAuthStore.values[state]

	if !ok {
		return pendingCanvaAuth{}, false
	}

	delete(canvaAuthStore.values, state)

	if time.Since(auth.CreatedAt) > pkceStateLifetime {
		return pendingCanvaAuth{}, false
	}

	return auth, true
}

// cleanupCanvaAuthStore removes expired authorization attempts.
func cleanupCanvaAuthStore() {
	now := time.Now()

	canvaAuthStore.Lock()
	defer canvaAuthStore.Unlock()

	for state, auth := range canvaAuthStore.values {
		if now.Sub(auth.CreatedAt) > pkceStateLifetime {
			delete(canvaAuthStore.values, state)
		}
	}
}

// handleCanvaOAuthCallback receives Canva's OAuth redirect.
//
// At this stage it validates state and returns the authorization code.
// The code_verifier remains server-side and is available for the next
// token-exchange step.
func handleCanvaOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := r.URL.Query()

	code := strings.TrimSpace(query.Get("code"))
	state := strings.TrimSpace(query.Get("state"))
	errorCode := strings.TrimSpace(query.Get("error"))
	errorDescription := strings.TrimSpace(query.Get("error_description"))

	if errorCode != "" {
		writeCanvaJSON(w, http.StatusBadRequest, map[string]any{
			"ok":                false,
			"error":             errorCode,
			"error_description": errorDescription,
		})
		return
	}

	if code == "" {
		http.Error(w, "missing Canva authorization code", http.StatusBadRequest)
		return
	}

	if state == "" {
		http.Error(w, "missing OAuth state", http.StatusBadRequest)
		return
	}

	pendingAuth, ok := getAndDeleteCanvaAuth(state)
	if !ok {
		http.Error(w, "invalid or expired OAuth state", http.StatusBadRequest)
		return
	}

	// IMPORTANT:
	// pendingAuth.CodeVerifier is the SAME verifier used to generate
	// the code_challenge sent to Canva.
	//
	// We will use it in the next step when exchanging the authorization
	// code for Canva access/refresh tokens.

	log.Printf("Canva OAuth authorization code received successfully")
	log.Printf("Canva OAuth state verified successfully")
	log.Printf("Canva PKCE verifier recovered successfully")

	writeCanvaJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": "Canva authorization succeeded. The OAuth state was verified and the PKCE verifier was recovered on the server.",
		"code":    code,
		"state":   state,
	})
}

func writeCanvaJSON(w http.ResponseWriter, status int, payload map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("failed to write Canva JSON response: %v", err)
	}
}
