package main

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"soc5-bots/internal/converter"
)

type config struct {
	Port           string
	WorkDir        string
	SharedToken    string
	MaxBase64Bytes int
}

type convertRequest struct {
	PDFBase64   string `json:"pdf_base64"`
	DPI         int    `json:"dpi"`
	ResizeWidth int    `json:"resize_width"`
	BorderPX    int    `json:"border_px"`
}

func main() {
	cfg := loadConfig()
	if err := os.MkdirAll(cfg.WorkDir, 0o755); err != nil {
		log.Fatalf("create work dir: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", health)
	mux.HandleFunc("POST /convert/pdf-to-png", convertPDFToPNG(cfg))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("pdf-to-png converter listening on :%s", cfg.Port)
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
	return config{
		Port:           getEnv("PORT", "8080"),
		WorkDir:        getEnv("WORK_DIR", "/tmp/pdf-to-png-converter"),
		SharedToken:    os.Getenv("PDF_TO_PNG_SERVICE_TOKEN"),
		MaxBase64Bytes: getInt("SEATALK_MAX_BASE64_BYTES", 5*1024*1024),
	}
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func convertPDFToPNG(cfg config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !validToken(cfg.SharedToken, r.Header.Get("Authorization")) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		req, err := readConvertRequest(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		rawPDF, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.PDFBase64))
		if err != nil {
			http.Error(w, "invalid pdf_base64", http.StatusBadRequest)
			return
		}
		if len(rawPDF) == 0 {
			http.Error(w, "pdf_base64 is required", http.StatusBadRequest)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()

		runDir, err := os.MkdirTemp(cfg.WorkDir, "convert-*")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer os.RemoveAll(runDir)

		pdfPath := filepath.Join(runDir, "report.pdf")
		pngPath := filepath.Join(runDir, "report.png")
		if err := os.WriteFile(pdfPath, rawPDF, 0o600); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if err := converter.PDFToPNG(ctx, pdfPath, pngPath, req.DPI, req.ResizeWidth, req.BorderPX); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		png, err := os.ReadFile(pngPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		encoded := base64.StdEncoding.EncodeToString(png)
		if len(encoded) > cfg.MaxBase64Bytes {
			http.Error(w, fmt.Sprintf("encoded image is %d bytes, over limit %d", len(encoded), cfg.MaxBase64Bytes), http.StatusRequestEntityTooLarge)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"image_base64": encoded})
	}
}

func readConvertRequest(r *http.Request) (convertRequest, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 16<<20))
	if err != nil {
		return convertRequest{}, errors.New("read body")
	}

	var req convertRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return convertRequest{}, errors.New("invalid json")
	}
	return req, nil
}

func validToken(expected, authorization string) bool {
	if expected == "" {
		return true
	}
	got := strings.TrimPrefix(authorization, "Bearer ")
	return subtle.ConstantTimeCompare([]byte(got), []byte(expected)) == 1
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
