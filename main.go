package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

const (
	eventVerification   = "event_verification"
	botAddedToGroupChat = "bot_added_to_group_chat"

	defaultSheetID  = "1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8"
	defaultSheetTab = "bot_groupid"
)

var sheetHeaders = []string{
	"bot_name",
	"app_id",
	"app_secret",
	"signing_secret",
	"group_id",
	"group_name",
	"is_active",
	"bot_description",
}

type BotCredential struct {
	BotName        string `json:"bot_name"`
	AppID          string `json:"app_id"`
	AppSecret      string `json:"app_secret"`
	SigningSecret  string `json:"signing_secret"`
	BotDescription string `json:"bot_description"`
}

type Server struct {
	botCredentials           map[string]BotCredential
	requireSignature         bool
	sheetID                  string
	sheetTab                 string
	serviceAccountConfigured bool
	sheet                    *BotGroupSheet
}

type BotGroupSheet struct {
	sheetID            string
	tabName            string
	serviceAccountFile string
	serviceAccountJSON string
	mu                 sync.Mutex
	service            *sheets.Service
}

type callbackPayload struct {
	EventType string         `json:"event_type"`
	AppID     string         `json:"app_id"`
	Event     map[string]any `json:"event"`
}

func main() {
	server, err := newServer()
	if err != nil {
		log.Fatalf("configuration error: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", server.handleRoot)
	mux.HandleFunc("/healthz", server.handleHealthz)
	mux.HandleFunc("/seatalk/callback", server.handleCallback)
	mux.HandleFunc("/seatalk/callback/", server.handleCallback)
	mux.HandleFunc("/callback", server.handleCallback)
	mux.HandleFunc("/callback/", server.handleCallback)

	port := getenv("PORT", getenv("BOT_PORT", "8000"))
	httpServer := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("listening on 0.0.0.0:%s", port)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server stopped: %v", err)
	}
}

func newServer() (*Server, error) {
	baseDir, err := os.Getwd()
	if err != nil {
		return nil, err
	}

	credentialsDir := getenv("BOT_CREDENTIALS_DIR", filepath.Join(baseDir, "credentials", "bot_credentials"))
	serviceAccountFile := getenv("GOOGLE_SERVICE_ACCOUNT_FILE", filepath.Join(baseDir, "credentials", "google-service-account.json"))
	serviceAccountJSON := strings.TrimSpace(os.Getenv("GOOGLE_SERVICE_ACCOUNT_JSON"))
	sheetID := getenv("SHEET_ID", defaultSheetID)
	sheetTab := getenv("SHEET_TAB_NAME", defaultSheetTab)
	requireSignature := strings.ToLower(os.Getenv("SEATALK_REQUIRE_SIGNATURE")) != "false"

	botCredentials, err := loadBotCredentialsFromEnv()
	if err != nil {
		return nil, err
	}
	if len(botCredentials) == 0 {
		botCredentials = loadBotCredentialsFromDir(credentialsDir)
	}

	return &Server{
		botCredentials:           botCredentials,
		requireSignature:         requireSignature,
		sheetID:                  sheetID,
		sheetTab:                 sheetTab,
		serviceAccountConfigured: serviceAccountJSON != "" || fileExists(serviceAccountFile),
		sheet: &BotGroupSheet{
			sheetID:            sheetID,
			tabName:            sheetTab,
			serviceAccountFile: serviceAccountFile,
			serviceAccountJSON: serviceAccountJSON,
		},
	}, nil
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	s.writeHealth(w)
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	s.writeHealth(w)
}

func (s *Server) writeHealth(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":                            "ok",
		"configured_bots":                   len(s.botCredentials),
		"sheet_id":                          s.sheetID,
		"sheet_tab":                         s.sheetTab,
		"google_service_account_configured": s.serviceAccountConfigured,
	})
}

func (s *Server) handleCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	rawBody, err := readBody(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_body"})
		return
	}

	var payload callbackPayload
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_json"})
		return
	}

	appID := strings.TrimSpace(payload.AppID)
	credential, ok := s.botCredentials[appID]
	if !ok {
		log.Printf("received callback for unknown app_id: %s", appID)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "unknown_app_id"})
		return
	}

	signature := r.Header.Get("Signature")
	if s.requireSignature && !isValidSignature(rawBody, credential.SigningSecret, signature) {
		log.Printf("rejected callback with invalid signature for app_id: %s", appID)
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid_signature"})
		return
	}

	switch payload.EventType {
	case eventVerification:
		writeJSON(w, http.StatusOK, map[string]any{
			"seatalk_challenge": stringFromMap(payload.Event, "seatalk_challenge"),
		})
	case botAddedToGroupChat:
		group, _ := payload.Event["group"].(map[string]any)
		groupID := strings.TrimSpace(stringFromMap(group, "group_id"))
		groupName := strings.TrimSpace(stringFromMap(group, "group_name"))
		if groupID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing_group_id"})
			return
		}

		result, err := s.sheet.UpsertBotGroup(r.Context(), credential, groupID, groupName, true)
		if err != nil {
			log.Printf("failed to store bot group: app_id=%s group_id=%s error=%v", appID, groupID, err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "sheet_write_failed"})
			return
		}
		log.Printf("stored bot group: bot_name=%s app_id=%s group_id=%s action=%s", credential.BotName, credential.AppID, groupID, result["action"])
		writeJSON(w, http.StatusOK, result)
	default:
		log.Printf("ignored SeaTalk event_type=%s app_id=%s", payload.EventType, appID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "ignored": payload.EventType})
	}
}

func (s *BotGroupSheet) serviceClient(ctx context.Context) (*sheets.Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.service != nil {
		return s.service, nil
	}

	var opts []option.ClientOption
	if strings.TrimSpace(s.serviceAccountJSON) != "" {
		credentials, err := google.CredentialsFromJSON(ctx, []byte(s.serviceAccountJSON), sheets.SpreadsheetsScope)
		if err != nil {
			return nil, err
		}
		opts = append(opts, option.WithCredentials(credentials))
	} else {
		opts = append(opts, option.WithCredentialsFile(s.serviceAccountFile), option.WithScopes(sheets.SpreadsheetsScope))
	}

	service, err := sheets.NewService(ctx, opts...)
	if err != nil {
		return nil, err
	}
	s.service = service
	return service, nil
}

func (s *BotGroupSheet) EnsureHeaders(ctx context.Context) error {
	service, err := s.serviceClient(ctx)
	if err != nil {
		return err
	}

	result, err := service.Spreadsheets.Values.Get(s.sheetID, s.sheetRange("A1:H1")).Do()
	if err != nil {
		return err
	}
	if len(result.Values) > 0 && rowMatchesHeaders(result.Values[0]) {
		return nil
	}

	values := make([]interface{}, len(sheetHeaders))
	for i, header := range sheetHeaders {
		values[i] = header
	}
	_, err = service.Spreadsheets.Values.Update(
		s.sheetID,
		s.sheetRange("A1:H1"),
		&sheets.ValueRange{Values: [][]interface{}{values}},
	).ValueInputOption("RAW").Do()
	return err
}

func (s *BotGroupSheet) UpsertBotGroup(ctx context.Context, credential BotCredential, groupID string, groupName string, isActive bool) (map[string]any, error) {
	if err := s.EnsureHeaders(ctx); err != nil {
		return nil, err
	}

	service, err := s.serviceClient(ctx)
	if err != nil {
		return nil, err
	}

	row := []interface{}{
		credential.BotName,
		credential.AppID,
		credential.AppSecret,
		credential.SigningSecret,
		groupID,
		groupName,
		boolString(isActive),
		credential.BotDescription,
	}

	result, err := service.Spreadsheets.Values.Get(s.sheetID, s.sheetRange("A2:H")).Do()
	if err != nil {
		return nil, err
	}
	targetRow := findTargetRow(result.Values, credential.AppID, groupID)
	if targetRow != 0 {
		_, err = service.Spreadsheets.Values.Update(
			s.sheetID,
			s.sheetRange(fmt.Sprintf("A%d:H%d", targetRow, targetRow)),
			&sheets.ValueRange{Values: [][]interface{}{row}},
		).ValueInputOption("RAW").Do()
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "action": "updated", "row": targetRow}, nil
	}

	_, err = service.Spreadsheets.Values.Append(
		s.sheetID,
		s.sheetRange("A:H"),
		&sheets.ValueRange{Values: [][]interface{}{row}},
	).ValueInputOption("RAW").InsertDataOption("INSERT_ROWS").Do()
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "action": "appended", "row": nil}, nil
}

func (s *BotGroupSheet) sheetRange(cellRange string) string {
	escapedTab := strings.ReplaceAll(s.tabName, "'", "''")
	return fmt.Sprintf("'%s'!%s", escapedTab, cellRange)
}

func loadBotCredentialsFromEnv() (map[string]BotCredential, error) {
	rawCredentials := strings.TrimSpace(os.Getenv("BOT_CREDENTIALS_JSON"))
	if rawCredentials == "" {
		return map[string]BotCredential{}, nil
	}

	var credentials []BotCredential
	if err := json.Unmarshal([]byte(rawCredentials), &credentials); err != nil {
		var credential BotCredential
		if objectErr := json.Unmarshal([]byte(rawCredentials), &credential); objectErr != nil {
			return nil, fmt.Errorf("BOT_CREDENTIALS_JSON must be a JSON object or array: %w", err)
		}
		credentials = []BotCredential{credential}
	}

	byAppID := map[string]BotCredential{}
	for index, credential := range credentials {
		credential.AppID = strings.TrimSpace(credential.AppID)
		credential.AppSecret = strings.TrimSpace(credential.AppSecret)
		credential.SigningSecret = strings.TrimSpace(credential.SigningSecret)
		if credential.AppID == "" || credential.AppSecret == "" || credential.SigningSecret == "" {
			return nil, fmt.Errorf("BOT_CREDENTIALS_JSON item %d must include app_id, app_secret, and signing_secret", index+1)
		}
		if strings.TrimSpace(credential.BotName) == "" {
			credential.BotName = credential.AppID
		}
		byAppID[credential.AppID] = credential
	}
	return byAppID, nil
}

func loadBotCredentialsFromDir(credentialsDir string) map[string]BotCredential {
	entries, err := os.ReadDir(credentialsDir)
	if err != nil {
		log.Printf("bot credentials directory does not exist or cannot be read: %s", credentialsDir)
		return map[string]BotCredential{}
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	credentials := map[string]BotCredential{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".txt") {
			continue
		}
		path := filepath.Join(credentialsDir, entry.Name())
		values, err := parseKeyValueFile(path)
		if err != nil {
			log.Printf("skipping %s: %v", entry.Name(), err)
			continue
		}
		if values["app_id"] == "" || values["app_secret"] == "" || values["signing_secret"] == "" {
			log.Printf("skipping %s because it is missing app_id, app_secret, or signing_secret", entry.Name())
			continue
		}

		botName := values["bot_name"]
		if botName == "" {
			botName = strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		}
		credential := BotCredential{
			BotName:        botName,
			AppID:          values["app_id"],
			AppSecret:      values["app_secret"],
			SigningSecret:  values["signing_secret"],
			BotDescription: values["bot_description"],
		}
		credentials[credential.AppID] = credential
	}
	return credentials
}

func parseKeyValueFile(path string) (map[string]string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	values := map[string]string{}
	for _, rawLine := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		values[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
	}
	return values, nil
}

func calculateSignature(rawBody []byte, signingSecret string) string {
	input := append(append([]byte{}, rawBody...), []byte(signingSecret)...)
	sum := sha256.Sum256(input)
	return hex.EncodeToString(sum[:])
}

func isValidSignature(rawBody []byte, signingSecret string, signature string) bool {
	signature = strings.ToLower(strings.TrimSpace(signature))
	if signature == "" {
		return false
	}
	expected := calculateSignature(rawBody, signingSecret)
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func findTargetRow(rows [][]interface{}, appID string, groupID string) int {
	firstBlankGroupRow := 0
	for index, row := range rows {
		rowNumber := index + 2
		rowAppID := valueAt(row, 1)
		rowGroupID := valueAt(row, 4)
		if rowAppID != appID {
			continue
		}
		if rowGroupID == groupID {
			return rowNumber
		}
		if rowGroupID == "" && firstBlankGroupRow == 0 {
			firstBlankGroupRow = rowNumber
		}
	}
	return firstBlankGroupRow
}

func rowMatchesHeaders(row []interface{}) bool {
	if len(row) < len(sheetHeaders) {
		return false
	}
	for index, header := range sheetHeaders {
		if fmt.Sprint(row[index]) != header {
			return false
		}
	}
	return true
}

func readBody(r *http.Request) ([]byte, error) {
	defer r.Body.Close()
	buf := new(bytes.Buffer)
	_, err := buf.ReadFrom(r.Body)
	return buf.Bytes(), err
}

func writeJSON(w http.ResponseWriter, status int, payload map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("failed to write response: %v", err)
	}
}

func methodNotAllowed(w http.ResponseWriter) {
	writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method_not_allowed"})
}

func stringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	return fmt.Sprint(values[key])
}

func valueAt(row []interface{}, index int) string {
	if len(row) <= index {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(row[index]))
}

func boolString(value bool) string {
	if value {
		return "TRUE"
	}
	return "FALSE"
}

func getenv(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
