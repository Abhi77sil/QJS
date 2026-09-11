package database

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"qjs-backend/models"

	_ "modernc.org/sqlite"
)

var (
	ErrNotFound            = errors.New("record not found")
	ErrDuplicateEmail      = errors.New("an account with this email address already exists")
	ErrDuplicateRegNo      = errors.New("an account with this registration number already exists")
	ErrDuplicatePhone      = errors.New("an account with this phone number already exists")
	ErrInsufficientBalance = errors.New("insufficient Qc balance")
)

type DB struct {
	SQL *sql.DB
}

// GenerateID generates a secure random hex ID.
func GenerateID(bytesLen int) string {
	b := make([]byte, bytesLen)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// InitDB initializes SQLite with proper pragmas and creates required tables.
func InitDB(dbPath string) (*DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	// modernc.org/sqlite connection string with busy timeout
	connStr := fmt.Sprintf("%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)", dbPath)
	sqlDB, err := sql.Open("sqlite", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}

	// Optimize connection pooling for SQLite with WAL mode
	sqlDB.SetMaxOpenConns(5) // Allow concurrent operations in WAL mode
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(time.Hour)

	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping sqlite database: %w", err)
	}

	db := &DB{SQL: sqlDB}
	if err := db.migrate(); err != nil {
		return nil, fmt.Errorf("failed to run database migrations: %w", err)
	}

	log.Printf("[DATABASE] SQLite connected at %s with WAL mode enabled", dbPath)
	return db, nil
}

func (db *DB) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		phone TEXT NOT NULL COLLATE NOCASE,
		reg_no TEXT NOT NULL COLLATE NOCASE,
		email TEXT NOT NULL COLLATE NOCASE,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'student',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_users_reg_no ON users(reg_no);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		token TEXT NOT NULL UNIQUE,
		expires_at DATETIME NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		last_active DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		user_agent TEXT,
		ip_address TEXT,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
	CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
	CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

	CREATE TABLE IF NOT EXISTS tasks (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		description TEXT NOT NULL,
		category TEXT NOT NULL,
		reward INTEGER NOT NULL,
		difficulty TEXT NOT NULL DEFAULT 'Medium',
		estimated_hours REAL NOT NULL DEFAULT 1.0,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		created_by TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
	CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
	CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);

	CREATE TABLE IF NOT EXISTS wallets (
		user_id TEXT PRIMARY KEY,
		balance INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS transactions (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		type TEXT NOT NULL,
		amount INTEGER NOT NULL,
		balance_after INTEGER NOT NULL,
		status TEXT NOT NULL DEFAULT 'SUCCESS',
		reference TEXT,
		description TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
	CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

	CREATE TABLE IF NOT EXISTS task_applications (
		id TEXT PRIMARY KEY,
		task_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'APPLIED',
		note TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		UNIQUE(task_id, user_id)
	);

	CREATE INDEX IF NOT EXISTS idx_applications_user ON task_applications(user_id);
	CREATE INDEX IF NOT EXISTS idx_applications_task ON task_applications(task_id);

	CREATE TABLE IF NOT EXISTS task_messages (
		id TEXT PRIMARY KEY,
		task_id TEXT NOT NULL,
		sender_id TEXT NOT NULL,
		recipient_id TEXT NOT NULL,
		content TEXT NOT NULL,
		is_read INTEGER NOT NULL DEFAULT 0,
		read_at DATETIME,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
		FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_messages_task ON task_messages(task_id);
	CREATE INDEX IF NOT EXISTS idx_messages_thread ON task_messages(task_id, sender_id, recipient_id);

	CREATE TABLE IF NOT EXISTS notifications (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		type TEXT NOT NULL,
		title TEXT NOT NULL,
		body TEXT NOT NULL,
		link TEXT,
		is_read INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
	`
	if _, err := db.SQL.Exec(schema); err != nil {
		return err
	}

	// Graceful migration for existing SQLite databases
	_, _ = db.SQL.Exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student';")
	_, _ = db.SQL.Exec("ALTER TABLE task_messages ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;")
	_, _ = db.SQL.Exec("ALTER TABLE task_messages ADD COLUMN read_at DATETIME;")
	_, _ = db.SQL.Exec("UPDATE users SET role = 'admin' WHERE LOWER(email) = 'ghost@intelcore.in';")

	return db.seedDefaultTasks()
}

// CreateUser inserts a new user, returning duplicate errors if email, regNo, or phone already exist.
func (db *DB) CreateUser(u *models.User) error {
	u.ID = "usr_" + GenerateID(12)
	u.CreatedAt = time.Now().UTC()
	u.UpdatedAt = time.Now().UTC()
	if u.Role == "" {
		u.Role = "student"
	}

	query := `
	INSERT INTO users (id, name, phone, reg_no, email, password_hash, role, created_at, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
	`
	_, err := db.SQL.Exec(query,
		u.ID,
		strings.TrimSpace(u.Name),
		strings.TrimSpace(u.Phone),
		strings.TrimSpace(u.RegNo),
		strings.TrimSpace(strings.ToLower(u.Email)),
		u.PasswordHash,
		u.Role,
		u.CreatedAt,
		u.UpdatedAt,
	)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "idx_users_email") || (strings.Contains(errStr, "UNIQUE constraint failed") && strings.Contains(errStr, "users.email")) {
			return ErrDuplicateEmail
		}
		if strings.Contains(errStr, "idx_users_reg_no") || (strings.Contains(errStr, "UNIQUE constraint failed") && strings.Contains(errStr, "users.reg_no")) {
			return ErrDuplicateRegNo
		}
		if strings.Contains(errStr, "idx_users_phone") || (strings.Contains(errStr, "UNIQUE constraint failed") && strings.Contains(errStr, "users.phone")) {
			return ErrDuplicatePhone
		}
		return err
	}
	return nil
}

// GetUserByIdentifier finds a user by either email, reg_no, or phone.
func (db *DB) GetUserByIdentifier(identifier string) (*models.User, error) {
	clean := strings.TrimSpace(identifier)
	lower := strings.ToLower(clean)

	query := `
	SELECT id, name, phone, reg_no, email, password_hash, role, created_at, updated_at
	FROM users
	WHERE email = ? OR reg_no = ? OR phone = ?
	LIMIT 1;
	`
	row := db.SQL.QueryRow(query, lower, clean, clean)

	var u models.User
	err := row.Scan(&u.ID, &u.Name, &u.Phone, &u.RegNo, &u.Email, &u.PasswordHash, &u.Role, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

// GetUserByID finds a user by primary ID.
func (db *DB) GetUserByID(id string) (*models.User, error) {
	query := `
	SELECT id, name, phone, reg_no, email, password_hash, role, created_at, updated_at
	FROM users
	WHERE id = ?
	LIMIT 1;
	`
	row := db.SQL.QueryRow(query, id)

	var u models.User
	err := row.Scan(&u.ID, &u.Name, &u.Phone, &u.RegNo, &u.Email, &u.PasswordHash, &u.Role, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

// CreateSession generates a new cryptographic session token and saves it in SQLite.
func (db *DB) CreateSession(userID string, duration time.Duration, userAgent, ip string) (*models.Session, error) {
	sess := &models.Session{
		ID:         "sess_" + GenerateID(12),
		UserID:     userID,
		Token:      "qjs_" + GenerateID(32), // 64 hex characters
		ExpiresAt:  time.Now().UTC().Add(duration),
		CreatedAt:  time.Now().UTC(),
		LastActive: time.Now().UTC(),
		UserAgent:  userAgent,
		IPAddress:  ip,
	}

	query := `
	INSERT INTO sessions (id, user_id, token, expires_at, created_at, last_active, user_agent, ip_address)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?);
	`
	_, err := db.SQL.Exec(query,
		sess.ID,
		sess.UserID,
		sess.Token,
		sess.ExpiresAt,
		sess.CreatedAt,
		sess.LastActive,
		sess.UserAgent,
		sess.IPAddress,
	)
	if err != nil {
		return nil, err
	}
	return sess, nil
}

// GetSessionAndUser validates a token against SQLite, ensures it is not expired,
// updates last_active timestamp, and returns both session and user details.
func (db *DB) GetSessionAndUser(token string) (*models.Session, *models.User, error) {
	if token == "" {
		return nil, nil, ErrNotFound
	}

	query := `
	SELECT 
		s.id, s.user_id, s.token, s.expires_at, s.created_at, s.last_active, s.user_agent, s.ip_address,
		u.id, u.name, u.phone, u.reg_no, u.email, u.password_hash, u.role, u.created_at, u.updated_at
	FROM sessions s
	INNER JOIN users u ON s.user_id = u.id
	WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP
	LIMIT 1;
	`
	row := db.SQL.QueryRow(query, token)

	var s models.Session
	var u models.User

	err := row.Scan(
		&s.ID, &s.UserID, &s.Token, &s.ExpiresAt, &s.CreatedAt, &s.LastActive, &s.UserAgent, &s.IPAddress,
		&u.ID, &u.Name, &u.Phone, &u.RegNo, &u.Email, &u.PasswordHash, &u.Role, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, ErrNotFound
		}
		return nil, nil, err
	}

	// Update last_active asynchronously or inline
	_, _ = db.SQL.Exec("UPDATE sessions SET last_active = ? WHERE id = ?", time.Now().UTC(), s.ID)

	return &s, &u, nil
}

// DeleteSession revokes a session token.
func (db *DB) DeleteSession(token string) error {
	_, err := db.SQL.Exec("DELETE FROM sessions WHERE token = ?", token)
	return err
}

// CleanExpiredSessions removes all expired sessions.
func (db *DB) CleanExpiredSessions() (int64, error) {
	res, err := db.SQL.Exec("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP")
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (db *DB) seedDefaultTasks() error {
	var count int
	err := db.SQL.QueryRow("SELECT COUNT(*) FROM tasks").Scan(&count)
	if err != nil || count > 0 {
		return nil
	}

	samples := []models.Task{
		{
			ID:             "task_poster_01",
			Title:          "Design a College Event Poster",
			Description:    "We need a bold, modern poster for the upcoming LPU Tech Fest. Deliver as a high-resolution PNG and source file.",
			Category:       "Design",
			Reward:         300,
			Difficulty:     "Medium",
			EstimatedHours: 2.0,
			CreatedBy:      "TechFest Committee",
		},
		{
			ID:             "task_notes_02",
			Title:          "Organize Data Structures Notes",
			Description:    "Digitalize and organize one semester of Data Structures handwritten notes into clean, typed PDFs.",
			Category:       "Academic",
			Reward:         150,
			Difficulty:     "Easy",
			EstimatedHours: 1.0,
			CreatedBy:      "Academic Club",
		},
		{
			ID:             "task_landing_03",
			Title:          "Create a Website Landing Page",
			Description:    "Build a responsive single-page marketing site for a student startup. HTML/CSS/JS with hero, features, and contact.",
			Category:       "Development",
			Reward:         800,
			Difficulty:     "Hard",
			EstimatedHours: 4.0,
			CreatedBy:      "Nova Startup Lab",
		},
		{
			ID:             "task_deliver_04",
			Title:          "Deliver Sealed Documents",
			Description:    "Pick up sealed administrative documents from Block 34 and deliver to Block 10 student affairs office before 5 PM.",
			Category:       "Delivery",
			Reward:         100,
			Difficulty:     "Easy",
			EstimatedHours: 0.5,
			CreatedBy:      "Admin Affairs",
		},
		{
			ID:             "task_photo_05",
			Title:          "Event Photography — Tech Meetup",
			Description:    "Cover a 2-hour student tech meetup in Block 32. Deliver 30+ edited photos within 24 hours.",
			Category:       "Photography",
			Reward:         600,
			Difficulty:     "Medium",
			EstimatedHours: 3.0,
			CreatedBy:      "Media Club",
		},
		{
			ID:             "task_tutor_06",
			Title:          "Tutor 2nd Year Students in Calculus",
			Description:    "Two-hour tutoring session for sophomore students on integration techniques and applications.",
			Category:       "Tutoring",
			Reward:         500,
			Difficulty:     "Hard",
			EstimatedHours: 2.0,
			CreatedBy:      "Study Circle",
		},
	}

	for _, s := range samples {
		_ = db.CreateTask(&s)
	}
	return nil
}

// GetAllTasks retrieves all tasks from SQLite ordered by creation time descending.
func (db *DB) GetAllTasks() ([]models.Task, error) {
	query := `
	SELECT id, title, description, category, reward, difficulty, estimated_hours, created_at, created_by
	FROM tasks
	ORDER BY created_at DESC;
	`
	rows, err := db.SQL.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.Task
	for rows.Next() {
		var t models.Task
		if err := rows.Scan(&t.ID, &t.Title, &t.Description, &t.Category, &t.Reward, &t.Difficulty, &t.EstimatedHours, &t.CreatedAt, &t.CreatedBy); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	if list == nil {
		list = []models.Task{}
	}
	return list, nil
}

// GetTaskByID retrieves a single task by its ID.
func (db *DB) GetTaskByID(id string) (*models.Task, error) {
	query := `
	SELECT id, title, description, category, reward, difficulty, estimated_hours, created_at, created_by
	FROM tasks
	WHERE id = ?;
	`
	var t models.Task
	err := db.SQL.QueryRow(query, id).Scan(&t.ID, &t.Title, &t.Description, &t.Category, &t.Reward, &t.Difficulty, &t.EstimatedHours, &t.CreatedAt, &t.CreatedBy)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

// CreateTask inserts a new task.
func (db *DB) CreateTask(t *models.Task) error {
	if t.ID == "" {
		t.ID = "task_" + GenerateID(8)
	}
	if t.CreatedAt.IsZero() {
		t.CreatedAt = time.Now().UTC()
	}

	query := `
	INSERT INTO tasks (id, title, description, category, reward, difficulty, estimated_hours, created_at, created_by)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
	`
	_, err := db.SQL.Exec(query,
		t.ID,
		strings.TrimSpace(t.Title),
		strings.TrimSpace(t.Description),
		strings.TrimSpace(t.Category),
		t.Reward,
		t.Difficulty,
		t.EstimatedHours,
		t.CreatedAt,
		t.CreatedBy,
	)
	return err
}

// DeleteTask removes a task by ID.
func (db *DB) DeleteTask(id string) error {
	res, err := db.SQL.Exec("DELETE FROM tasks WHERE id = ?", id)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

// GetOrCreateWallet ensures a wallet exists for the user and returns it.
func (db *DB) GetOrCreateWallet(userID string) (*models.Wallet, error) {
	var w models.Wallet
	query := `SELECT user_id, balance, created_at, updated_at FROM wallets WHERE user_id = ? LIMIT 1;`
	err := db.SQL.QueryRow(query, userID).Scan(&w.UserID, &w.Balance, &w.CreatedAt, &w.UpdatedAt)
	if err == nil {
		return &w, nil
	}

	if errors.Is(err, sql.ErrNoRows) {
		w = models.Wallet{
			UserID:    userID,
			Balance:   0, // initial balance
			CreatedAt: time.Now().UTC(),
			UpdatedAt: time.Now().UTC(),
		}
		insert := `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES (?, ?, ?, ?);`
		_, insErr := db.SQL.Exec(insert, w.UserID, w.Balance, w.CreatedAt, w.UpdatedAt)
		if insErr != nil {
			// If already created concurrently, re-read
			if readErr := db.SQL.QueryRow(query, userID).Scan(&w.UserID, &w.Balance, &w.CreatedAt, &w.UpdatedAt); readErr == nil {
				return &w, nil
			}
			return nil, insErr
		}
		return &w, nil
	}
	return nil, err
}

// TopupWallet atomically credits the user's wallet and records the transaction.
func (db *DB) TopupWallet(userID string, amount int, reference, description string) (*models.Wallet, *models.Transaction, error) {
	if amount <= 0 {
		return nil, nil, errors.New("topup amount must be greater than zero")
	}

	tx, err := db.SQL.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	// Ensure wallet exists
	_, _ = tx.Exec(`INSERT OR IGNORE INTO wallets (user_id, balance, created_at, updated_at) VALUES (?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`, userID)

	// Fetch current balance with row lock in SQLite
	var currentBalance int
	row := tx.QueryRow(`SELECT balance FROM wallets WHERE user_id = ?;`, userID)
	if err := row.Scan(&currentBalance); err != nil {
		return nil, nil, fmt.Errorf("failed to load wallet: %w", err)
	}

	newBalance := currentBalance + amount

	// Update balance
	_, err = tx.Exec(`UPDATE wallets SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?;`, newBalance, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to update wallet balance: %w", err)
	}

	// Insert transaction record
	txnID := "tx_" + GenerateID(10)
	if reference == "" {
		reference = "ref_" + GenerateID(12)
	}
	now := time.Now().UTC()

	_, err = tx.Exec(`
		INSERT INTO transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
		VALUES (?, ?, 'TOPUP', ?, ?, 'COMPLETED', ?, ?, ?);
	`, txnID, userID, amount, newBalance, reference, description, now)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to record transaction: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}

	wallet := &models.Wallet{
		UserID:    userID,
		Balance:   newBalance,
		UpdatedAt: now,
	}

	txn := &models.Transaction{
		ID:           txnID,
		UserID:       userID,
		Type:         "TOPUP",
		Amount:       amount,
		BalanceAfter: newBalance,
		Status:       "COMPLETED",
		Reference:    reference,
		Description:  description,
		CreatedAt:    now,
	}

	return wallet, txn, nil
}

// AdjustWallet allows administrators to manually credit or debit a student's Qc wallet with an audit reason.
func (db *DB) AdjustWallet(userID string, amount int, reason string) (*models.Wallet, *models.Transaction, error) {
	if amount == 0 {
		return nil, nil, errors.New("adjustment amount cannot be zero")
	}

	tx, err := db.SQL.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	_, _ = tx.Exec(`INSERT OR IGNORE INTO wallets (user_id, balance, created_at, updated_at) VALUES (?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`, userID)

	var currentBalance int
	row := tx.QueryRow(`SELECT balance FROM wallets WHERE user_id = ?;`, userID)
	if err := row.Scan(&currentBalance); err != nil {
		return nil, nil, fmt.Errorf("failed to load wallet: %w", err)
	}

	newBalance := currentBalance + amount
	if newBalance < 0 {
		return nil, nil, ErrInsufficientBalance
	}

	_, err = tx.Exec(`UPDATE wallets SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?;`, newBalance, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to update wallet balance: %w", err)
	}

	txnID := "tx_" + GenerateID(10)
	ref := "adj_" + GenerateID(12)
	now := time.Now().UTC()

	_, err = tx.Exec(`
		INSERT INTO transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
		VALUES (?, ?, 'ADMIN_ADJUST', ?, ?, 'COMPLETED', ?, ?, ?);
	`, txnID, userID, amount, newBalance, ref, reason, now)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to record adjustment transaction: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}

	wallet := &models.Wallet{
		UserID:    userID,
		Balance:   newBalance,
		UpdatedAt: now,
	}

	txn := &models.Transaction{
		ID:           txnID,
		UserID:       userID,
		Type:         "ADMIN_ADJUST",
		Amount:       amount,
		BalanceAfter: newBalance,
		Status:       "COMPLETED",
		Reference:    ref,
		Description:  reason,
		CreatedAt:    now,
	}

	return wallet, txn, nil
}

// GetUserTransactions returns the most recent transactions for a given user.
func (db *DB) GetUserTransactions(userID string, limit int) ([]models.Transaction, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	query := `
	SELECT id, user_id, type, amount, balance_after, status, reference, description, created_at
	FROM transactions
	WHERE user_id = ?
	ORDER BY created_at DESC
	LIMIT ?;
	`
	rows, err := db.SQL.Query(query, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.UserID, &t.Type, &t.Amount, &t.BalanceAfter, &t.Status, &t.Reference, &t.Description, &t.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, nil
}

// GetAllTransactions returns global transaction records for the admin economy dashboard.
func (db *DB) GetAllTransactions(limit int) ([]models.Transaction, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	query := `
	SELECT id, user_id, type, amount, balance_after, status, reference, description, created_at
	FROM transactions
	ORDER BY created_at DESC
	LIMIT ?;
	`
	rows, err := db.SQL.Query(query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.UserID, &t.Type, &t.Amount, &t.BalanceAfter, &t.Status, &t.Reference, &t.Description, &t.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, nil
}

// GetAllUsersWithWallets returns user profiles combined with their Qc balances.
func (db *DB) GetAllUsersWithWallets() ([]models.UserWalletRecord, error) {
	query := `
	SELECT u.id, u.name, u.email, u.reg_no, u.phone, u.role, COALESCE(w.balance, 0), u.created_at
	FROM users u
	LEFT JOIN wallets w ON u.id = w.user_id
	ORDER BY u.created_at DESC;
	`
	rows, err := db.SQL.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.UserWalletRecord
	for rows.Next() {
		var r models.UserWalletRecord
		if err := rows.Scan(&r.ID, &r.Name, &r.Email, &r.RegNo, &r.Phone, &r.Role, &r.Balance, &r.CreatedAt); err != nil {
			return nil, err
		}
		if strings.EqualFold(r.Email, "ghost@intelcore.in") || r.Role == "admin" {
			r.Role = "admin"
			r.IsAdmin = true
		}
		list = append(list, r)
	}
	return list, nil
}

// GetEconomyKPIs returns aggregate platform economy metrics.
func (db *DB) GetEconomyKPIs() (*models.EconomyKPIs, error) {
	kpi := &models.EconomyKPIs{}

	// Total circulating Qc
	_ = db.SQL.QueryRow(`SELECT COALESCE(SUM(balance), 0) FROM wallets;`).Scan(&kpi.CirculatingQc)

	// Total registered users
	_ = db.SQL.QueryRow(`SELECT COUNT(*) FROM users;`).Scan(&kpi.TotalUsers)

	// Total tasks
	_ = db.SQL.QueryRow(`SELECT COUNT(*) FROM tasks;`).Scan(&kpi.TotalTasks)

	// Total volume across transactions
	_ = db.SQL.QueryRow(`SELECT COALESCE(SUM(ABS(amount)), 0) FROM transactions WHERE status = 'COMPLETED';`).Scan(&kpi.TotalVolumeQc)

	// Total topups
	_ = db.SQL.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'TOPUP' AND status = 'COMPLETED';`).Scan(&kpi.TotalTopupsQc)

	if kpi.TotalUsers > 0 {
		kpi.AverageBalanceQc = float64(kpi.CirculatingQc) / float64(kpi.TotalUsers)
	}

	return kpi, nil
}

// TransferQc handles atomic peer-to-peer coin transfer between two campus students.
func (db *DB) TransferQc(senderID, recipientIdentifier string, amount int, note string) (*models.Wallet, *models.Transaction, *models.User, error) {
	if amount <= 0 {
		return nil, nil, nil, errors.New("transfer amount must be at least 1 Qc")
	}

	recipient, err := db.GetUserByIdentifier(recipientIdentifier)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil, nil, errors.New("recipient student not found with that email, registration number, or phone")
		}
		return nil, nil, nil, err
	}

	if recipient.ID == senderID {
		return nil, nil, nil, errors.New("cannot transfer coins to yourself")
	}

	sender, err := db.GetUserByID(senderID)
	if err != nil {
		return nil, nil, nil, errors.New("sender account invalid")
	}

	tx, err := db.SQL.Begin()
	if err != nil {
		return nil, nil, nil, err
	}
	defer tx.Rollback()

	// Ensure both wallets exist
	_, _ = tx.Exec(`INSERT OR IGNORE INTO wallets (user_id, balance, created_at, updated_at) VALUES (?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`, senderID)
	_, _ = tx.Exec(`INSERT OR IGNORE INTO wallets (user_id, balance, created_at, updated_at) VALUES (?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`, recipient.ID)

	// Check sender balance
	var senderBal int
	if err := tx.QueryRow(`SELECT balance FROM wallets WHERE user_id = ?;`, senderID).Scan(&senderBal); err != nil {
		return nil, nil, nil, err
	}
	if senderBal < amount {
		return nil, nil, nil, ErrInsufficientBalance
	}

	newSenderBal := senderBal - amount
	var recipBal int
	_ = tx.QueryRow(`SELECT balance FROM wallets WHERE user_id = ?;`, recipient.ID).Scan(&recipBal)
	newRecipBal := recipBal + amount

	// Deduct sender
	if _, err := tx.Exec(`UPDATE wallets SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?;`, newSenderBal, senderID); err != nil {
		return nil, nil, nil, err
	}
	// Credit recipient
	if _, err := tx.Exec(`UPDATE wallets SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?;`, newRecipBal, recipient.ID); err != nil {
		return nil, nil, nil, err
	}

	now := time.Now().UTC()
	transferRef := "trf_" + GenerateID(10)
	senderTxnID := "tx_" + GenerateID(10)
	recipTxnID := "tx_" + GenerateID(10)

	senderDesc := fmt.Sprintf("Transferred %d Qc to %s (%s)", amount, recipient.Name, recipient.RegNo)
	if note != "" {
		senderDesc += " - Note: " + note
	}
	recipDesc := fmt.Sprintf("Received %d Qc from %s (%s)", amount, sender.Name, sender.RegNo)
	if note != "" {
		recipDesc += " - Note: " + note
	}

	senderRef := transferRef + "-out"
	recipRef := transferRef + "-in"

	// Sender transaction (amount is negative)
	_, err = tx.Exec(`
		INSERT INTO transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
		VALUES (?, ?, 'TRANSFER_OUT', ?, ?, 'COMPLETED', ?, ?, ?);
	`, senderTxnID, senderID, -amount, newSenderBal, senderRef, senderDesc, now)
	if err != nil {
		return nil, nil, nil, err
	}

	// Recipient transaction (amount is positive)
	_, err = tx.Exec(`
		INSERT INTO transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
		VALUES (?, ?, 'TRANSFER_IN', ?, ?, 'COMPLETED', ?, ?, ?);
	`, recipTxnID, recipient.ID, amount, newRecipBal, recipRef, recipDesc, now)
	if err != nil {
		return nil, nil, nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, nil, err
	}

	senderWallet := &models.Wallet{
		UserID:    senderID,
		Balance:   newSenderBal,
		UpdatedAt: now,
	}

	senderTxn := &models.Transaction{
		ID:           senderTxnID,
		UserID:       senderID,
		Type:         "TRANSFER_OUT",
		Amount:       -amount,
		BalanceAfter: newSenderBal,
		Status:       "COMPLETED",
		Reference:    senderRef,
		Description:  senderDesc,
		CreatedAt:    now,
	}

	return senderWallet, senderTxn, recipient, nil
}

// WithdrawQc atomically deducts coins and records a payout request.
func (db *DB) WithdrawQc(userID string, amount int, method, payoutDetails string) (*models.Wallet, *models.Transaction, error) {
	if amount < 50 {
		return nil, nil, errors.New("minimum withdrawal is 50 Qc (₹50)")
	}
	if payoutDetails == "" {
		return nil, nil, errors.New("payout details (UPI ID or Bank Details) required")
	}

	tx, err := db.SQL.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	_, _ = tx.Exec(`INSERT OR IGNORE INTO wallets (user_id, balance, created_at, updated_at) VALUES (?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`, userID)

	var currentBal int
	if err := tx.QueryRow(`SELECT balance FROM wallets WHERE user_id = ?;`, userID).Scan(&currentBal); err != nil {
		return nil, nil, err
	}
	if currentBal < amount {
		return nil, nil, ErrInsufficientBalance
	}

	newBal := currentBal - amount
	if _, err := tx.Exec(`UPDATE wallets SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?;`, newBal, userID); err != nil {
		return nil, nil, err
	}

	txnID := "tx_" + GenerateID(10)
	ref := "wth_" + GenerateID(12)
	now := time.Now().UTC()
	desc := fmt.Sprintf("Withdrawal of %d Qc to %s (%s)", amount, method, payoutDetails)

	_, err = tx.Exec(`
		INSERT INTO transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
		VALUES (?, ?, 'WITHDRAWAL', ?, ?, 'COMPLETED', ?, ?, ?);
	`, txnID, userID, -amount, newBal, ref, desc, now)
	if err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}

	wallet := &models.Wallet{
		UserID:    userID,
		Balance:   newBal,
		UpdatedAt: now,
	}

	txn := &models.Transaction{
		ID:           txnID,
		UserID:       userID,
		Type:         "WITHDRAWAL",
		Amount:       -amount,
		BalanceAfter: newBal,
		Status:       "COMPLETED",
		Reference:    ref,
		Description:  desc,
		CreatedAt:    now,
	}

	return wallet, txn, nil
}

// GetStudentEconomySummary aggregates a personalized financial dashboard for the logged-in student.
func (db *DB) GetStudentEconomySummary(userID string) (*models.StudentEconomySummary, error) {
	wallet, err := db.GetOrCreateWallet(userID)
	if err != nil {
		return nil, err
	}

	summary := &models.StudentEconomySummary{
		Success:  true,
		Balance:  wallet.Balance,
		Currency: "Qc",
	}

	// Total earned from incoming transfers, rewards, stipends
	_ = db.SQL.QueryRow(`
		SELECT COALESCE(SUM(amount), 0) FROM transactions
		WHERE user_id = ? AND amount > 0 AND type != 'TOPUP';
	`, userID).Scan(&summary.TotalEarned)

	// Total spent / transferred out
	_ = db.SQL.QueryRow(`
		SELECT COALESCE(SUM(ABS(amount)), 0) FROM transactions
		WHERE user_id = ? AND amount < 0 AND type != 'WITHDRAWAL';
	`, userID).Scan(&summary.TotalSpent)

	// Total withdrawn
	_ = db.SQL.QueryRow(`
		SELECT COALESCE(SUM(ABS(amount)), 0) FROM transactions
		WHERE user_id = ? AND type = 'WITHDRAWAL';
	`, userID).Scan(&summary.TotalWithdrawn)

	txns, err := db.GetUserTransactions(userID, 50)
	if err != nil {
		txns = []models.Transaction{}
	}
	summary.Transactions = txns

	return summary, nil
}

// ApplyForTask registers a student's application to work on a task.
func (db *DB) ApplyForTask(userID, taskID, note string) (*models.TaskApplication, error) {
	task, err := db.GetTaskByID(taskID)
	if err != nil {
		return nil, errors.New("task not found")
	}

	user, err := db.GetUserByID(userID)
	if err != nil {
		return nil, errors.New("applicant account not found")
	}

	// Prevent user from applying to their own task
	if task.CreatedBy == userID || task.CreatedBy == user.Name || task.CreatedBy == user.Email {
		return nil, errors.New("you cannot apply to a task you published")
	}

	appID := "app_" + GenerateID(10)
	now := time.Now().UTC()

	// Try inserting; if user already applied previously, update note and set status back to APPLIED
	_, err = db.SQL.Exec(`
		INSERT INTO task_applications (id, task_id, user_id, status, note, created_at, updated_at)
		VALUES (?, ?, ?, 'APPLIED', ?, ?, ?)
		ON CONFLICT(task_id, user_id) DO UPDATE SET
			status = 'APPLIED',
			note = excluded.note,
			updated_at = excluded.updated_at;
	`, appID, taskID, userID, strings.TrimSpace(note), now, now)
	if err != nil {
		return nil, err
	}

	var app models.TaskApplication
	err = db.SQL.QueryRow(`
		SELECT id, task_id, user_id, status, note, created_at, updated_at
		FROM task_applications WHERE task_id = ? AND user_id = ?;
	`, taskID, userID).Scan(&app.ID, &app.TaskID, &app.UserID, &app.Status, &app.Note, &app.CreatedAt, &app.UpdatedAt)
	if err != nil {
		return nil, err
	}

	// Trigger in-app notification for the task publisher
	publisherID := task.CreatedBy
	publisher, _ := db.GetUserByID(publisherID)
	if publisher == nil {
		publisher, _ = db.GetUserByIdentifier(publisherID)
	}
	if publisher == nil {
		var pID string
		if err := db.SQL.QueryRow("SELECT id FROM users WHERE name = ? OR email = ? LIMIT 1;", task.CreatedBy, task.CreatedBy).Scan(&pID); err == nil && pID != "" {
			publisherID = pID
		}
	} else {
		publisherID = publisher.ID
	}
	_ = db.CreateNotification(&models.Notification{
		ID:        "ntf_" + GenerateID(10),
		UserID:    publisherID,
		Type:      "NEW_APPLICATION",
		Title:     "New Applicant for " + task.Title,
		Body:      fmt.Sprintf("%s applied: \"%s\"", user.Name, note),
		Link:      "/tasks.html?tab=published",
		IsRead:    false,
		CreatedAt: now,
	})

	return &app, nil
}

// WithdrawTaskApplication marks an application as WITHDRAWN.
func (db *DB) WithdrawTaskApplication(userID, applicationID, taskID string) (*models.TaskApplication, error) {
	res, err := db.SQL.Exec(`
		UPDATE task_applications
		SET status = 'WITHDRAWN', updated_at = CURRENT_TIMESTAMP
		WHERE user_id = ? AND (id = ? OR task_id = ?);
	`, userID, applicationID, taskID)
	if err != nil {
		return nil, err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return nil, errors.New("application not found or not authorized to withdraw")
	}

	var app models.TaskApplication
	err = db.SQL.QueryRow(`
		SELECT id, task_id, user_id, status, note, created_at, updated_at
		FROM task_applications
		WHERE user_id = ? AND (id = ? OR task_id = ?);
	`, userID, applicationID, taskID).Scan(
		&app.ID, &app.TaskID, &app.UserID, &app.Status, &app.Note, &app.CreatedAt, &app.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	return &app, nil
}

// UpdateApplicationStatus allows the task creator to accept or reject an application.
func (db *DB) UpdateApplicationStatus(publisherID, applicationID, newStatus string) (*models.TaskApplication, error) {
	newStatus = strings.ToUpper(strings.TrimSpace(newStatus))
	if newStatus != "ACCEPTED" && newStatus != "REJECTED" && newStatus != "APPLIED" {
		return nil, errors.New("invalid application status")
	}

	// Verify publisher owns the task
	var taskCreator string
	err := db.SQL.QueryRow(`
		SELECT t.created_by FROM tasks t
		JOIN task_applications a ON t.id = a.task_id
		WHERE a.id = ?;
	`, applicationID).Scan(&taskCreator)
	if err != nil {
		return nil, errors.New("application not found")
	}

	publisher, _ := db.GetUserByID(publisherID)
	if taskCreator != publisherID && (publisher == nil || (taskCreator != publisher.Name && taskCreator != publisher.Email)) {
		return nil, errors.New("not authorized to manage applications for this task")
	}

	res, err := db.SQL.Exec(`
		UPDATE task_applications
		SET status = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?;
	`, newStatus, applicationID)
	if err != nil {
		return nil, err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return nil, errors.New("application not found")
	}

	var app models.TaskApplication
	err = db.SQL.QueryRow(`
		SELECT id, task_id, user_id, status, note, created_at, updated_at
		FROM task_applications
		WHERE id = ?;
	`, applicationID).Scan(&app.ID, &app.TaskID, &app.UserID, &app.Status, &app.Note, &app.CreatedAt, &app.UpdatedAt)
	if err != nil {
		return nil, err
	}

	// Notify the applicant
	task, _ := db.GetTaskByID(app.TaskID)
	taskTitle := "Campus Task"
	if task != nil {
		taskTitle = task.Title
	}
	_ = db.CreateNotification(&models.Notification{
		ID:        "ntf_" + GenerateID(10),
		UserID:    app.UserID,
		Type:      "APPLICATION_STATUS",
		Title:     "Application " + newStatus,
		Body:      fmt.Sprintf("Your application for '%s' has been %s.", taskTitle, strings.ToLower(newStatus)),
		Link:      "/tasks.html",
		IsRead:    false,
		CreatedAt: time.Now().UTC(),
	})

	return &app, nil
}

// GetUserApplications returns all tasks applied for by a student with publisher and task details.
func (db *DB) GetUserApplications(userID string) ([]models.TaskApplicationView, error) {
	query := `
		SELECT 
			a.id, a.task_id, a.user_id, a.status, a.note, a.created_at, a.updated_at,
			t.title, t.description, t.category, t.reward, t.estimated_hours, t.difficulty,
			t.created_by,
			COALESCE(u.id, ''), COALESCE(u.name, t.created_by), COALESCE(u.email, ''), COALESCE(u.reg_no, ''), COALESCE(u.role, 'admin')
		FROM task_applications a
		JOIN tasks t ON a.task_id = t.id
		LEFT JOIN users u ON u.id = t.created_by OR u.name = t.created_by OR u.email = t.created_by
		WHERE a.user_id = ?
		ORDER BY a.created_at DESC;
	`
	rows, err := db.SQL.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.TaskApplicationView
	for rows.Next() {
		var v models.TaskApplicationView
		var rawCreatedBy string
		if err := rows.Scan(
			&v.ID, &v.TaskID, &v.UserID, &v.Status, &v.Note, &v.CreatedAt, &v.UpdatedAt,
			&v.TaskTitle, &v.TaskDesc, &v.TaskCategory, &v.TaskReward, &v.TaskHours, &v.TaskDifficulty,
			&rawCreatedBy,
			&v.PublisherID, &v.PublisherName, &v.PublisherEmail, &v.PublisherRegNo, &v.PublisherRole,
		); err != nil {
			return nil, err
		}
		if v.PublisherID == "" {
			v.PublisherID = rawCreatedBy
		}
		list = append(list, v)
	}

	if list == nil {
		list = []models.TaskApplicationView{}
	}
	return list, nil
}

// GetPublishedTasksWithApplicants retrieves tasks created by the student along with applicants.
func (db *DB) GetPublishedTasksWithApplicants(userID string) ([]models.PublishedTaskView, error) {
	user, err := db.GetUserByID(userID)
	if err != nil {
		return nil, err
	}

	query := `
		SELECT id, title, description, category, reward, difficulty, estimated_hours, created_by, created_at
		FROM tasks
		WHERE created_by = ? OR created_by = ? OR created_by = ?
		ORDER BY created_at DESC;
	`
	rows, err := db.SQL.Query(query, userID, user.Name, user.Email)
	if err != nil {
		return nil, err
	}

	var result []models.PublishedTaskView
	for rows.Next() {
		var pt models.PublishedTaskView
		if err := rows.Scan(
			&pt.ID, &pt.Title, &pt.Description, &pt.Category, &pt.Reward,
			&pt.Difficulty, &pt.EstimatedHours, &pt.CreatedBy, &pt.CreatedAt,
		); err != nil {
			rows.Close()
			return nil, err
		}
		pt.CreatorRole = user.Role
		pt.Applicants = []models.TaskApplicationView{}
		result = append(result, pt)
	}
	rows.Close()

	// Fetch applicants for each task now that outer rows are closed
	for i := range result {
		appQuery := `
			SELECT 
				a.id, a.task_id, a.user_id, a.status, a.note, a.created_at, a.updated_at,
				u.name, u.email, u.reg_no, u.role
			FROM task_applications a
			JOIN users u ON a.user_id = u.id
			WHERE a.task_id = ?
			ORDER BY a.created_at ASC;
		`
		appRows, err := db.SQL.Query(appQuery, result[i].ID)
		if err == nil {
			for appRows.Next() {
				var av models.TaskApplicationView
				if err := appRows.Scan(
					&av.ID, &av.TaskID, &av.UserID, &av.Status, &av.Note, &av.CreatedAt, &av.UpdatedAt,
					&av.ApplicantName, &av.ApplicantEmail, &av.ApplicantRegNo, &av.ApplicantRole,
				); err == nil {
					av.TaskTitle = result[i].Title
					av.TaskReward = result[i].Reward
					result[i].Applicants = append(result[i].Applicants, av)
				}
			}
			appRows.Close()
		}
	}

	if result == nil {
		result = []models.PublishedTaskView{}
	}
	return result, nil
}

// SendTaskMessage saves a chat message between applicant and task publisher.
func (db *DB) SendTaskMessage(taskID, senderID, recipientID, content string) (*models.TaskMessage, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, errors.New("message content cannot be empty")
	}

	msgID := "msg_" + GenerateID(10)
	now := time.Now().UTC()

	_, err := db.SQL.Exec(`
		INSERT INTO task_messages (id, task_id, sender_id, recipient_id, content, is_read, created_at)
		VALUES (?, ?, ?, ?, ?, 0, ?);
	`, msgID, taskID, senderID, recipientID, content, now)
	if err != nil {
		return nil, err
	}

	sender, _ := db.GetUserByID(senderID)
	recip, _ := db.GetUserByID(recipientID)

	msg := &models.TaskMessage{
		ID:          msgID,
		TaskID:      taskID,
		SenderID:    senderID,
		RecipientID: recipientID,
		Content:     content,
		IsRead:      false,
		CreatedAt:   now,
	}
	if sender != nil {
		msg.SenderName = sender.Name
		msg.SenderRole = sender.Role
	}
	if recip != nil {
		msg.RecipientName = recip.Name
		msg.RecipientRole = recip.Role
	}

	// Trigger in-app notification for the recipient
	senderName := "Campus Peer"
	if sender != nil {
		senderName = sender.Name
	}
	task, _ := db.GetTaskByID(taskID)
	taskTitle := "Campus Task"
	if task != nil {
		taskTitle = task.Title
	}

	snippet := content
	if len(snippet) > 65 {
		snippet = snippet[:62] + "..."
	}

	_ = db.CreateNotification(&models.Notification{
		ID:        "ntf_" + GenerateID(10),
		UserID:    recipientID,
		Type:      "MESSAGE",
		Title:     "Message from " + senderName,
		Body:      fmt.Sprintf("[%s] %s", taskTitle, snippet),
		Link:      fmt.Sprintf("/tasks.html?chatTask=%s&peerId=%s", taskID, senderID),
		IsRead:    false,
		CreatedAt: now,
	})

	return msg, nil
}

// GetTaskConversation returns the chat conversation between two users for a specific task.
func (db *DB) GetTaskConversation(taskID, userID, peerID string) ([]models.TaskMessage, error) {
	query := `
		SELECT 
			m.id, m.task_id, m.sender_id, m.recipient_id, m.content, m.is_read, m.read_at, m.created_at,
			s.name, s.role, r.name, r.role
		FROM task_messages m
		JOIN users s ON m.sender_id = s.id
		JOIN users r ON m.recipient_id = r.id
		WHERE m.task_id = ?
		  AND ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
		ORDER BY m.created_at ASC;
	`
	rows, err := db.SQL.Query(query, taskID, userID, peerID, peerID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []models.TaskMessage
	for rows.Next() {
		var m models.TaskMessage
		var isReadInt int
		var readAt sql.NullTime
		if err := rows.Scan(
			&m.ID, &m.TaskID, &m.SenderID, &m.RecipientID, &m.Content, &isReadInt, &readAt, &m.CreatedAt,
			&m.SenderName, &m.SenderRole, &m.RecipientName, &m.RecipientRole,
		); err != nil {
			return nil, err
		}
		m.IsRead = (isReadInt == 1)
		if readAt.Valid {
			m.ReadAt = &readAt.Time
		}
		messages = append(messages, m)
	}

	if messages == nil {
		messages = []models.TaskMessage{}
	}
	return messages, nil
}

// MarkMessagesAsRead marks unread incoming messages from peer to user in this task as read.
func (db *DB) MarkMessagesAsRead(taskID, userID, peerID string) (int64, error) {
	query := `
		UPDATE task_messages
		SET is_read = 1, read_at = CURRENT_TIMESTAMP
		WHERE task_id = ? AND recipient_id = ? AND sender_id = ? AND is_read = 0;
	`
	res, err := db.SQL.Exec(query, taskID, userID, peerID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// CreateNotification inserts an in-app notification record into SQLite.
func (db *DB) CreateNotification(n *models.Notification) error {
	if n.ID == "" {
		n.ID = "ntf_" + GenerateID(10)
	}
	if n.CreatedAt.IsZero() {
		n.CreatedAt = time.Now().UTC()
	}
	_, err := db.SQL.Exec(`
		INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at)
		VALUES (?, ?, ?, ?, ?, ?, 0, ?);
	`, n.ID, n.UserID, n.Type, n.Title, n.Body, n.Link, n.CreatedAt)
	return err
}

// GetUserNotifications retrieves recent notifications for a user.
func (db *DB) GetUserNotifications(userID string, limit int) ([]models.Notification, error) {
	if limit <= 0 {
		limit = 30
	}
	rows, err := db.SQL.Query(`
		SELECT id, user_id, type, title, body, link, is_read, created_at
		FROM notifications
		WHERE user_id = ?
		ORDER BY created_at DESC
		LIMIT ?;
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.Notification
	for rows.Next() {
		var n models.Notification
		var isReadInt int
		var link sql.NullString
		if err := rows.Scan(&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &link, &isReadInt, &n.CreatedAt); err != nil {
			return nil, err
		}
		n.IsRead = (isReadInt == 1)
		if link.Valid {
			n.Link = link.String
		}
		list = append(list, n)
	}
	if list == nil {
		list = []models.Notification{}
	}
	return list, nil
}

// MarkNotificationsAsRead marks all unread notifications for a user as read.
func (db *DB) MarkNotificationsAsRead(userID string) error {
	_, err := db.SQL.Exec(`
		UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0;
	`, userID)
	return err
}

// GetUnreadSummary calculates unread messages and notifications for navigation badges.
func (db *DB) GetUnreadSummary(userID string) (*models.UnreadSummary, error) {
	summary := &models.UnreadSummary{
		UnreadByTask: make(map[string]int),
		UnreadByPeer: make(map[string]int),
	}

	// Total unread messages
	_ = db.SQL.QueryRow(`
		SELECT COUNT(*) FROM task_messages WHERE recipient_id = ? AND is_read = 0;
	`, userID).Scan(&summary.TotalUnreadMessages)

	// Unread messages grouped by task
	rows, err := db.SQL.Query(`
		SELECT task_id, COUNT(*) FROM task_messages
		WHERE recipient_id = ? AND is_read = 0
		GROUP BY task_id;
	`, userID)
	if err == nil {
		for rows.Next() {
			var tid string
			var cnt int
			if err := rows.Scan(&tid, &cnt); err == nil {
				summary.UnreadByTask[tid] = cnt
			}
		}
		rows.Close()
	}

	// Unread messages grouped by peer
	peerRows, err := db.SQL.Query(`
		SELECT sender_id, COUNT(*) FROM task_messages
		WHERE recipient_id = ? AND is_read = 0
		GROUP BY sender_id;
	`, userID)
	if err == nil {
		for peerRows.Next() {
			var pid string
			var cnt int
			if err := peerRows.Scan(&pid, &cnt); err == nil {
				summary.UnreadByPeer[pid] = cnt
			}
		}
		peerRows.Close()
	}

	// Total unread notifications
	_ = db.SQL.QueryRow(`
		SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0;
	`, userID).Scan(&summary.TotalUnreadNotifications)

	return summary, nil
}

// TouchUserPresence updates the user's latest activity timestamp in sessions.
func (db *DB) TouchUserPresence(userID string) error {
	now := time.Now().UTC()
	_, err := db.SQL.Exec(`
		UPDATE sessions SET last_active = ? WHERE user_id = ?;
	`, now, userID)
	return err
}

// GetUsersPresence returns online/offline status for requested user IDs.
// A user is considered online if last_active was within the past 60 seconds.
func (db *DB) GetUsersPresence(userIDs []string) (map[string]models.UserPresence, error) {
	result := make(map[string]models.UserPresence)
	if len(userIDs) == 0 {
		return result, nil
	}

	now := time.Now().UTC()
	threshold := now.Add(-60 * time.Second)

	for _, uid := range userIDs {
		var presence models.UserPresence
		presence.UserID = uid
		presence.IsOnline = false
		presence.LastSeen = time.Time{}

		var rawVal any
		err := db.SQL.QueryRow(`
			SELECT last_active FROM sessions WHERE user_id = ? ORDER BY last_active DESC LIMIT 1;
		`, uid).Scan(&rawVal)

		if err == nil && rawVal != nil {
			var parsedTime time.Time
			var ok bool
			switch v := rawVal.(type) {
			case time.Time:
				parsedTime = v.UTC()
				ok = true
			case []byte:
				parsedTime, ok = parseTimeFlex(string(v))
			case string:
				parsedTime, ok = parseTimeFlex(v)
			}

			if ok {
				presence.LastSeen = parsedTime
				presence.IsOnline = parsedTime.After(threshold)
			}
		}

		result[uid] = presence
	}

	return result, nil
}

func parseTimeFlex(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	formats := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05-07:00",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

