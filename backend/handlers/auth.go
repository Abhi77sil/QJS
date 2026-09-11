package handlers

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"qjs-backend/database"
	"qjs-backend/models"

	"golang.org/x/crypto/bcrypt"
)

var (
	emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	phoneRegex = regexp.MustCompile(`^[0-9+\s\-]{7,15}$`)
	letterReg  = regexp.MustCompile(`[a-zA-Z]`)
	numberReg  = regexp.MustCompile(`[0-9]`)
)

type AuthHandler struct {
	DB *database.DB
}

func NewAuthHandler(db *database.DB) *AuthHandler {
	return &AuthHandler{DB: db}
}

// IsAdminEmail checks if the provided email matches any email in admin.txt.
func IsAdminEmail(email string) bool {
	clean := strings.ToLower(strings.TrimSpace(email))
	if clean == "" {
		return false
	}

	paths := []string{
		"admin.txt",
		"backend/admin.txt",
		"../admin.txt",
		filepath.Join("..", "admin.txt"),
		filepath.Join(".", "data", "admin.txt"),
	}

	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err == nil {
			scanner := bufio.NewScanner(bytes.NewReader(data))
			for scanner.Scan() {
				line := strings.ToLower(strings.TrimSpace(scanner.Text()))
				if line != "" && !strings.HasPrefix(line, "#") && line == clean {
					return true
				}
			}
			return false
		}
	}
	return false
}

// JSON write helper
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, models.ErrorResponse{
		Success: false,
		Error:   msg,
	})
}

// ExtractBearerToken parses the Bearer token from the Authorization header or X-Session-Token.
func ExtractBearerToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return strings.TrimSpace(authHeader[7:])
	}
	if tok := r.Header.Get("X-Session-Token"); tok != "" {
		return strings.TrimSpace(tok)
	}
	// Fallback to cookie if present
	if cookie, err := r.Cookie("qjs_session"); err == nil && cookie.Value != "" {
		return cookie.Value
	}
	return ""
}

// Signup handles POST /api/auth/signup
func (h *AuthHandler) Signup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req models.SignupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON payload")
		return
	}

	// Validation
	req.Name = strings.TrimSpace(req.Name)
	req.Phone = strings.TrimSpace(req.Phone)
	req.RegNo = strings.TrimSpace(req.RegNo)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "Full name is required.")
		return
	}
	if !phoneRegex.MatchString(req.Phone) {
		writeError(w, http.StatusBadRequest, "Please enter a valid phone number (7-15 digits).")
		return
	}
	if req.RegNo == "" {
		writeError(w, http.StatusBadRequest, "Registration number is required.")
		return
	}
	if !emailRegex.MatchString(req.Email) {
		writeError(w, http.StatusBadRequest, "Please enter a valid email address.")
		return
	}
	if len(req.Password) < 6 {
		writeError(w, http.StatusBadRequest, "Password must be at least 6 characters.")
		return
	}
	if !letterReg.MatchString(req.Password) {
		writeError(w, http.StatusBadRequest, "Password must contain at least one letter.")
		return
	}
	if !numberReg.MatchString(req.Password) {
		writeError(w, http.StatusBadRequest, "Password must contain at least one number.")
		return
	}
	if req.Password != req.Confirm {
		writeError(w, http.StatusBadRequest, "Passwords do not match.")
		return
	}

	// Hash password
	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to securely process password.")
		return
	}

	role := strings.ToLower(strings.TrimSpace(req.Role))
	if IsAdminEmail(req.Email) {
		role = "admin"
	} else if role != "faculty" {
		role = "student"
	}

	user := &models.User{
		Name:         req.Name,
		Phone:        req.Phone,
		RegNo:        req.RegNo,
		Email:        req.Email,
		PasswordHash: string(hashed),
		Role:         role,
	}

	if err := h.DB.CreateUser(user); err != nil {
		if errors.Is(err, database.ErrDuplicateEmail) ||
			errors.Is(err, database.ErrDuplicateRegNo) ||
			errors.Is(err, database.ErrDuplicatePhone) {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "Failed to create account. Please try again.")
		return
	}

	// Create session for the new user (default 24 hours)
	userAgent := r.UserAgent()
	ip := r.RemoteAddr
	sess, err := h.DB.CreateSession(user.ID, 24*time.Hour, userAgent, ip)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Account created, but failed to initialize session.")
		return
	}

	writeJSON(w, http.StatusCreated, models.AuthResponse{
		Success: true,
		Message: "Account created successfully.",
		Token:   sess.Token,
		User: &models.UserPublic{
			ID:        user.ID,
			Name:      user.Name,
			Phone:     user.Phone,
			RegNo:     user.RegNo,
			Email:     user.Email,
			Role:      user.Role,
			IsAdmin:   IsAdminEmail(user.Email) || user.Role == "admin",
			CreatedAt: user.CreatedAt,
		},
	})
}

// Login handles POST /api/auth/login
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON payload")
		return
	}

	req.Identifier = strings.TrimSpace(req.Identifier)
	if req.Identifier == "" {
		writeError(w, http.StatusBadRequest, "Enter your email, registration number, or phone.")
		return
	}
	if req.Password == "" {
		writeError(w, http.StatusBadRequest, "Password is required.")
		return
	}

	user, err := h.DB.GetUserByIdentifier(req.Identifier)
	if err != nil {
		if errors.Is(err, database.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, "Invalid credentials. Please check your details.")
			return
		}
		writeError(w, http.StatusInternalServerError, "Authentication error. Please try again.")
		return
	}

	// Compare bcrypt hash
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid credentials. Please check your details.")
		return
	}

	// Determine session duration: 30 days if rememberMe, otherwise 24 hours
	duration := 24 * time.Hour
	if req.RememberMe {
		duration = 30 * 24 * time.Hour
	}

	userAgent := r.UserAgent()
	ip := r.RemoteAddr
	sess, err := h.DB.CreateSession(user.ID, duration, userAgent, ip)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create user session.")
		return
	}

	role := user.Role
	isAdmin := IsAdminEmail(user.Email) || user.Role == "admin"
	if isAdmin {
		role = "admin"
	}

	writeJSON(w, http.StatusOK, models.AuthResponse{
		Success: true,
		Message: "Logged in successfully.",
		Token:   sess.Token,
		User: &models.UserPublic{
			ID:        user.ID,
			Name:      user.Name,
			Phone:     user.Phone,
			RegNo:     user.RegNo,
			Email:     user.Email,
			Role:      role,
			IsAdmin:   isAdmin,
			CreatedAt: user.CreatedAt,
		},
	})
}

// Me handles GET /api/auth/me (Session Check)
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "No session token provided. Please log in.")
		return
	}

	sess, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Session expired or invalid. Please log in again.")
		return
	}

	role := user.Role
	isAdmin := IsAdminEmail(user.Email) || user.Role == "admin"
	if isAdmin {
		role = "admin"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"session": map[string]any{
			"id":        sess.ID,
			"expiresAt": sess.ExpiresAt,
		},
		"user": models.UserPublic{
			ID:        user.ID,
			Name:      user.Name,
			Phone:     user.Phone,
			RegNo:     user.RegNo,
			Email:     user.Email,
			Role:      role,
			IsAdmin:   isAdmin,
			CreatedAt: user.CreatedAt,
		},
	})
}

// Logout handles POST /api/auth/logout
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token != "" {
		_ = h.DB.DeleteSession(token)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Logged out successfully.",
	})
}

// Health handles GET /api/health
func (h *AuthHandler) Health(w http.ResponseWriter, r *http.Request) {
	dbErr := h.DB.SQL.Ping()
	dbStatus := "connected"
	if dbErr != nil {
		dbStatus = "unhealthy"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"service":   "Quick Jobs Core API",
		"database":  dbStatus,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// Tasks handles GET (list all), POST (create task, admin only), and DELETE (delete task, admin only)
func (h *AuthHandler) Tasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tasks, err := h.DB.GetAllTasks()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to load tasks")
			return
		}
		if tasks == nil {
			tasks = []models.Task{}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"tasks":   tasks,
		})

	case http.MethodPost:
		// Admin only verification
		token := ExtractBearerToken(r)
		if token == "" {
			writeError(w, http.StatusUnauthorized, "Authentication required to create tasks")
			return
		}
		_, user, err := h.DB.GetSessionAndUser(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Invalid or expired session")
			return
		}
		if !IsAdminEmail(user.Email) {
			writeError(w, http.StatusForbidden, "Forbidden: Only administrators in admin.txt can create tasks")
			return
		}

		var req models.CreateTaskRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid task data")
			return
		}

		req.Title = strings.TrimSpace(req.Title)
		req.Description = strings.TrimSpace(req.Description)
		req.Category = strings.TrimSpace(req.Category)
		if req.Title == "" {
			writeError(w, http.StatusBadRequest, "Task title is required")
			return
		}
		if req.Category == "" {
			req.Category = "General"
		}
		if req.Reward <= 0 {
			writeError(w, http.StatusBadRequest, "Reward amount must be greater than 0")
			return
		}
		if req.Difficulty == "" {
			req.Difficulty = "Medium"
		}
		if req.EstimatedHours <= 0 {
			req.EstimatedHours = 1.0
		}

		task := models.Task{
			Title:          req.Title,
			Description:    req.Description,
			Category:       req.Category,
			Reward:         req.Reward,
			Difficulty:     req.Difficulty,
			EstimatedHours: req.EstimatedHours,
			CreatedBy:      user.Name,
		}

		if err := h.DB.CreateTask(&task); err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to create task in database")
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"success": true,
			"message": "Task created successfully",
			"task":    task,
		})

	case http.MethodDelete:
		// Admin only verification
		token := ExtractBearerToken(r)
		if token == "" {
			writeError(w, http.StatusUnauthorized, "Authentication required to delete tasks")
			return
		}
		_, user, err := h.DB.GetSessionAndUser(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Invalid or expired session")
			return
		}
		if !IsAdminEmail(user.Email) {
			writeError(w, http.StatusForbidden, "Forbidden: Only administrators in admin.txt can delete tasks")
			return
		}

		taskID := strings.TrimSpace(r.URL.Query().Get("id"))
		if taskID == "" {
			writeError(w, http.StatusBadRequest, "Task ID is required (parameter 'id')")
			return
		}

		if err := h.DB.DeleteTask(taskID); err != nil {
			if errors.Is(err, database.ErrNotFound) {
				writeError(w, http.StatusNotFound, "Task not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "Failed to delete task from database")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"message": "Task deleted successfully",
			"id":      taskID,
		})

	default:
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}
