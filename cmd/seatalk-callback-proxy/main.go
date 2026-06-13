package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

type config struct {
	Port             string
	CallbackPath     string
	SigningSecret    string
	AppsScriptURL    string
	ForwardTimeout   time.Duration
	MaxCallbackBytes int64
}

type callbackEnvelope struct {
	EventType string         `json:"event_type"`
	Event     map[string]any `json:"event"`
}

func main() {
	cfg := loadConfig()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", health)
	mux.HandleFunc("POST "+cfg.CallbackPath, callback(cfg))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("seatalk callback proxy listening on :%s%s", cfg.Port, cfg.CallbackPath)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("http shutdown: %v", err)
	}
}

func loadConfig() config {
	callbackPath := getEnv("SEATALK_CALLBACK_PATH", "/bot-callback")
	if !strings.HasPrefix(callbackPath, "/") {
		callbackPath = "/" + callbackPath
	}

	return config{
		Port:             getEnv("PORT", "8080"),
		CallbackPath:     callbackPath,
		SigningSecret:    os.Getenv("SEATALK_SIGNING_SECRET"),
		AppsScriptURL:    os.Getenv("APPS_SCRIPT_WEB_APP_URL"),
		ForwardTimeout:   20 * time.Second,
		MaxCallbackBytes: 2 << 20,
	}
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func callback(cfg config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, cfg.MaxCallbackBytes))
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}

		var event callbackEnvelope
		if err := json.Unmarshal(body, &event); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}

		signature := r.Header.Get("Signature")
		if signature == "" {
			signature = r.Header.Get("signature")
		}
		if !validSignature(cfg.SigningSecret, body, signature) {
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if event.EventType == "event_verification" {
			challenge := extractChallenge(body, event)
			if challenge == "" {
				http.Error(w, "missing seatalk_challenge", http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"seatalk_challenge": challenge})
			return
		}

		if cfg.AppsScriptURL != "" {
			if err := forwardToAppsScript(r.Context(), cfg, body); err != nil {
				log.Printf("forward event %s failed: %v", event.EventType, err)
			}
		}

		_, _ = w.Write([]byte(`{}`))
	}
}

func extractChallenge(body []byte, event callbackEnvelope) string {
	if event.Event != nil {
		if challenge, _ := event.Event["seatalk_challenge"].(string); challenge != "" {
			return challenge
		}
		if challenge, _ := event.Event["challenge"].(string); challenge != "" {
			return challenge
		}
	}

	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		return ""
	}
	if challenge, _ := raw["seatalk_challenge"].(string); challenge != "" {
		return challenge
	}
	if challenge, _ := raw["challenge"].(string); challenge != "" {
		return challenge
	}
	return ""
}

func validSignature(signingSecret string, body []byte, signature string) bool {
	if signingSecret == "" {
		return true
	}
	sum := sha256.Sum256(append(body, []byte(signingSecret)...))
	calculated := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(calculated), []byte(strings.ToLower(signature))) == 1
}

func forwardToAppsScript(ctx context.Context, cfg config, body []byte) error {
	forwardCtx, cancel := context.WithTimeout(ctx, cfg.ForwardTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(forwardCtx, http.MethodPost, cfg.AppsScriptURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("apps script status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	return nil
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
