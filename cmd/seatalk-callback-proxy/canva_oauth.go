package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
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
	canvaTokenURL     = "https://api.canva.com/rest/v1/oauth/token"

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

// ------------------------------------------------------------
// PKCE
// ------------------------------------------------------------

func generateCodeVerifier() (string, error) {
	// 96 random bytes produces a high-entropy URL-safe verifier.
	b := make([]byte, 96)

	if _, err := rand.Read(b); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(b), nil
}

func generateCodeChallenge(codeVerifier string) string {
	sum := sha256.Sum256([]byte(codeVerifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func generateOAuthState() (string, error) {
	b := make([]byte, 32)

	if _, err := rand.Read(b); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(b), nil
}

// ------------------------------------------------------------
// GET /canva/authorize
// ------------------------------------------------------------

func canvaAuthorize(w http.ResponseWriter, r *http.Request) {
	clientID := strings.TrimSpace(os.Getenv("CANVA_CLIENT_ID"))

	if clientID == "" {
		http.Error(w, "CANVA_CLIENT_ID is not configured", http.StatusInternalServerError)
		return
	}

	redirectURI := strings.TrimSpace(os.Getenv("CANVA_REDIRECT_URI"))

	if redirectURI == "" {
		redirectURI = "https://soc-11-automation.onrender.com/seatalk/callback"
	}

	scopes := strings.TrimSpace(os.Getenv("CANVA_SCOPES"))

	if scopes == "" {
		scopes = "asset:read"
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

	// Store the verifier server-side.
	canvaAuthStore.Lock()
	canvaAuthStore.values[state] = pendingCanvaAuth{
		CodeVerifier: codeVerifier,
		CreatedAt:    time.Now(),
	}
	canvaAuthStore.Unlock()

	cleanupCanvaAuthStore()

	authURL, err := url.Parse(canvaAuthorizeURL)
	if err != nil {
		http.Error(w, "failed to build Canva authorization URL", http.StatusInternalServerError)
		return
	}

	query := authURL.Query()

	query.Set("code_challenge", codeChallenge)
	query.Set("code_challenge_method", "S256")
	query.Set("scope", scopes)
	query.Set("response_type", "code")
	query.Set("client_id", clientID)
	query.Set("state", state)
	query.Set("redirect_uri", redirectURI)

	authURL.RawQuery = query.Encode()

	http.Redirect(w, r, authURL.String(), http.StatusFound)
}

// ------------------------------------------------------------
// OAuth state
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// GET /seatalk/callback
// ------------------------------------------------------------

func handleCanvaOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := r.URL.Query()

	// Canva may return an OAuth error instead of a code.
	if oauthError := query.Get("error"); oauthError != "" {
		description := query.Get("error_description")

		log.Printf(
			"Canva OAuth error: %s - %s",
			oauthError,
			description,
		)

		http.Error(
			w,
			"Canva authorization was not completed",
			http.StatusBadRequest,
		)
		return
	}

	code := query.Get("code")
	state := query.Get("state")

	if code == "" {
		http.Error(
			w,
			"missing Canva authorization code",
			http.StatusBadRequest,
		)
		return
	}

	if state == "" {
		http.Error(
			w,
			"missing OAuth state",
			http.StatusBadRequest,
		)
		return
	}

	// Recover and consume the original PKCE verifier.
	pendingAuth, ok := getAndDeleteCanvaAuth(state)

	if !ok {
		http.Error(
			w,
			"invalid or expired OAuth state",
			http.StatusBadRequest,
		)
		return
	}

	log.Printf("Canva OAuth state verified; PKCE verifier recovered")

	// Exchange authorization code for tokens.
	tokenResponse, err := exchangeCanvaAuthorizationCode(
		code,
		pendingAuth.CodeVerifier,
	)

	if err != nil {
		log.Printf("Canva token exchange failed: %v", err)

		http.Error(
			w,
			"Canva token exchange failed",
			http.StatusBadGateway,
		)
		return
	}

	// IMPORTANT:
	// Do not log access_token or refresh_token.
	log.Printf("Canva OAuth token exchange succeeded")

	writeCanvaJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": "Canva authorization and token exchange succeeded.",
		"token": map[string]any{
		    "access_token":  tokenResponse.AccessToken,
		    "refresh_token": tokenResponse.RefreshToken,
		    "token_type":    tokenResponse.TokenType,
		    "expires_in":    tokenResponse.ExpiresIn,
		    "scope":         tokenResponse.Scope,
		},
	})
}

// ------------------------------------------------------------
// Canva token exchange
// ------------------------------------------------------------

type canvaTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
}

func exchangeCanvaAuthorizationCode(
	code string,
	codeVerifier string,
) (*canvaTokenResponse, error) {

	clientID := strings.TrimSpace(os.Getenv("CANVA_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("CANVA_CLIENT_SECRET"))
	redirectURI := strings.TrimSpace(os.Getenv("CANVA_REDIRECT_URI"))

	if clientID == "" {
		return nil, fmt.Errorf("CANVA_CLIENT_ID is not configured")
	}

	if clientSecret == "" {
		return nil, fmt.Errorf("CANVA_CLIENT_SECRET is not configured")
	}

	if redirectURI == "" {
		return nil, fmt.Errorf("CANVA_REDIRECT_URI is not configured")
	}

	form := url.Values{}

	form.Set("grant_type", "authorization_code")
	form.Set("code_verifier", codeVerifier)
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)

	req, err := http.NewRequest(
		http.MethodPost,
		canvaTokenURL,
		strings.NewReader(form.Encode()),
	)

	if err != nil {
		return nil, fmt.Errorf("create token request: %w", err)
	}

	req.Header.Set(
		"Authorization",
		"Basic "+base64.StdEncoding.EncodeToString(
			[]byte(clientID+":"+clientSecret),
		),
	)

	req.Header.Set(
		"Content-Type",
		"application/x-www-form-urlencoded",
	)

	client := &http.Client{
		Timeout: 20 * time.Second,
	}

	resp, err := client.Do(req)

	if err != nil {
		return nil, fmt.Errorf("send token request: %w", err)
	}

	defer resp.Body.Close()

	body, err := io.ReadAll(
		io.LimitReader(resp.Body, 1<<20),
	)

	if err != nil {
		return nil, fmt.Errorf("read token response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Log status only, not credentials or authorization codes.
		return nil, fmt.Errorf(
			"Canva returned HTTP %d",
			resp.StatusCode,
		)
	}

	var tokenResponse canvaTokenResponse

	if err := json.Unmarshal(body, &tokenResponse); err != nil {
		return nil, fmt.Errorf(
			"decode Canva token response: %w",
			err,
		)
	}

	if tokenResponse.AccessToken == "" {
		return nil, fmt.Errorf(
			"Canva response did not contain an access token",
		)
	}

	return &tokenResponse, nil
}

// ------------------------------------------------------------
// JSON helper
// ------------------------------------------------------------

func writeCanvaJSON(
	w http.ResponseWriter,
	status int,
	value any,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	_ = json.NewEncoder(w).Encode(value)
}
