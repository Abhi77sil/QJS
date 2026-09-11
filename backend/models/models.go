package models

import "time"

// User represents a registered campus user.
type User struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Phone        string    `json:"phone"`
	RegNo        string    `json:"regNo"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"` // student, faculty, admin
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// UserPublic represents the sanitized user object returned to clients.
type UserPublic struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Phone     string    `json:"phone"`
	RegNo     string    `json:"regNo"`
	Email     string    `json:"email"`
	Role      string    `json:"role"` // student, faculty, admin
	IsAdmin   bool      `json:"isAdmin"`
	CreatedAt time.Time `json:"createdAt"`
}

// Session represents an active authenticated session token.
type Session struct {
	ID         string    `json:"id"`
	UserID     string    `json:"userId"`
	Token      string    `json:"token"`
	ExpiresAt  time.Time `json:"expiresAt"`
	CreatedAt  time.Time `json:"createdAt"`
	LastActive time.Time `json:"lastActive"`
	UserAgent  string    `json:"userAgent,omitempty"`
	IPAddress  string    `json:"ipAddress,omitempty"`
}

// SignupRequest defines fields sent during registration.
type SignupRequest struct {
	Name     string `json:"name"`
	Phone    string `json:"phone"`
	RegNo    string `json:"regNo"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Confirm  string `json:"confirm"`
	Role     string `json:"role,omitempty"` // student, faculty
}

// LoginRequest defines fields sent during login.
type LoginRequest struct {
	Identifier string `json:"identifier"` // Email, RegNo, or Phone
	Password   string `json:"password"`
	RememberMe bool   `json:"rememberMe"`
}

// AuthResponse defines the payload returned on successful authentication.
type AuthResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Token   string      `json:"token,omitempty"`
	User    *UserPublic `json:"user,omitempty"`
}

// ErrorResponse defines standard JSON error output.
type ErrorResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

// Task represents a campus gig/task in SQLite.
type Task struct {
	ID             string    `json:"id"`
	Title          string    `json:"title"`
	Description    string    `json:"description"`
	Category       string    `json:"category"`
	Reward         int       `json:"reward"` // In Qc (1 Qc = ₹1)
	Difficulty     string    `json:"difficulty"`
	EstimatedHours float64   `json:"estimatedHours"`
	CreatedAt      time.Time `json:"createdAt"`
	CreatedBy      string    `json:"createdBy"`
}

// CreateTaskRequest defines fields for admin creating a task.
type CreateTaskRequest struct {
	Title          string  `json:"title"`
	Description    string  `json:"description"`
	Category       string  `json:"category"`
	Reward         int     `json:"reward"`
	Difficulty     string  `json:"difficulty"`
	EstimatedHours float64 `json:"estimatedHours"`
}

// Wallet represents a user's Qc currency balance in SQLite.
type Wallet struct {
	UserID    string    `json:"userId"`
	Balance   int       `json:"balance"` // Quick Coins (Qc)
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Transaction represents an audit entry for coin movements.
type Transaction struct {
	ID           string    `json:"id"`
	UserID       string    `json:"userId"`
	Type         string    `json:"type"` // TOPUP, TASK_REWARD, TRANSFER, ADMIN_ADJUST
	Amount       int       `json:"amount"`
	BalanceAfter int       `json:"balanceAfter"`
	Status       string    `json:"status"` // COMPLETED, PENDING, FAILED
	Reference    string    `json:"reference"`
	Description  string    `json:"description"`
	CreatedAt    time.Time `json:"createdAt"`
}

// TopupRequest defines user wallet top-up input.
type TopupRequest struct {
	Amount int    `json:"amount"` // in Qc (minimum 10)
	Method string `json:"method"` // upi, card, netbanking
}

// WalletResponse defines active user wallet data output.
type WalletResponse struct {
	Success      bool          `json:"success"`
	Balance      int           `json:"balance"`
	Currency     string        `json:"currency"`
	Transactions []Transaction `json:"transactions"`
}

// UserWalletRecord gives the admin a composite view of student profile and wallet.
type UserWalletRecord struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	RegNo     string    `json:"regNo"`
	Phone     string    `json:"phone"`
	Role      string    `json:"role"`
	IsAdmin   bool      `json:"isAdmin"`
	Balance   int       `json:"balance"`
	CreatedAt time.Time `json:"createdAt"`
}

// WalletAdjustmentRequest defines admin manual adjustment input.
type WalletAdjustmentRequest struct {
	UserID string `json:"userId"`
	Amount int    `json:"amount"` // positive to credit, negative to debit
	Reason string `json:"reason"`
}

// EconomyKPIs defines overall platform economy statistics.
type EconomyKPIs struct {
	CirculatingQc    int     `json:"circulatingQc"`
	TotalUsers       int     `json:"totalUsers"`
	TotalTasks       int     `json:"totalTasks"`
	TotalVolumeQc    int     `json:"totalVolumeQc"`
	TotalTopupsQc    int     `json:"totalTopupsQc"`
	AverageBalanceQc float64 `json:"averageBalanceQc"`
}

// TransferRequest defines input for peer-to-peer coin transfer.
type TransferRequest struct {
	RecipientIdentifier string `json:"recipientIdentifier"` // Email, RegNo, or Phone
	Recipient           string `json:"recipient"`          // Alias for convenience
	Amount              int    `json:"amount"`             // in Qc (minimum 1)
	Note                string `json:"note"`
}

// WithdrawRequest defines student payout input.
type WithdrawRequest struct {
	Amount        int    `json:"amount"`        // in Qc (minimum 50)
	PayoutMethod  string `json:"payoutMethod"`  // UPI or BANK
	Method        string `json:"method"`        // Alias for convenience
	PayoutDetails string `json:"payoutDetails"` // UPI ID or Account/IFSC
}

// StudentEconomySummary provides a personalized financial overview.
type StudentEconomySummary struct {
	Success        bool          `json:"success"`
	Balance        int           `json:"balance"`
	Currency       string        `json:"currency"`
	TotalEarned    int           `json:"totalEarned"`
	TotalSpent     int           `json:"totalSpent"`
	TotalWithdrawn int           `json:"totalWithdrawn"`
	Transactions   []Transaction `json:"transactions"`
}

// TaskApplication represents a student's application to work on a task.
type TaskApplication struct {
	ID        string    `json:"id"`
	TaskID    string    `json:"taskId"`
	UserID    string    `json:"userId"`
	Status    string    `json:"status"` // APPLIED, ACCEPTED, REJECTED, WITHDRAWN
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// TaskApplicationView provides enriched application data including task and publisher info.
type TaskApplicationView struct {
	ID             string    `json:"id"`
	TaskID         string    `json:"taskId"`
	UserID         string    `json:"userId"`
	Status         string    `json:"status"`
	Note           string    `json:"note"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
	TaskTitle      string    `json:"taskTitle"`
	TaskDesc       string    `json:"taskDesc"`
	TaskCategory   string    `json:"taskCategory"`
	TaskReward     int       `json:"taskReward"`
	TaskHours      float64   `json:"taskHours"`
	TaskDifficulty string    `json:"taskDifficulty"`
	PublisherID    string    `json:"publisherId"`
	PublisherName  string    `json:"publisherName"`
	PublisherEmail string    `json:"publisherEmail"`
	PublisherRegNo string    `json:"publisherRegNo"`
	PublisherRole  string    `json:"publisherRole,omitempty"`
	ApplicantName  string    `json:"applicantName,omitempty"`
	ApplicantEmail string    `json:"applicantEmail,omitempty"`
	ApplicantRegNo string    `json:"applicantRegNo,omitempty"`
	ApplicantRole  string    `json:"applicantRole,omitempty"`
}

// TaskMessage represents a chat message sent regarding a specific task.
type TaskMessage struct {
	ID            string     `json:"id"`
	TaskID        string     `json:"taskId"`
	SenderID      string     `json:"senderId"`
	RecipientID   string     `json:"recipientId"`
	SenderName    string     `json:"senderName,omitempty"`
	SenderRole    string     `json:"senderRole,omitempty"`
	RecipientName string     `json:"recipientName,omitempty"`
	RecipientRole string     `json:"recipientRole,omitempty"`
	Content       string     `json:"content"`
	IsRead        bool       `json:"isRead"`
	ReadAt        *time.Time `json:"readAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
}

// Notification represents an in-app alert for messages, application status, etc.
type Notification struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Type      string    `json:"type"` // MESSAGE, APPLICATION_STATUS, NEW_APPLICATION
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Link      string    `json:"link,omitempty"`
	IsRead    bool      `json:"isRead"`
	CreatedAt time.Time `json:"createdAt"`
}

// UserPresence tracks whether a student or admin is currently active online.
type UserPresence struct {
	UserID   string    `json:"userId"`
	IsOnline bool      `json:"isOnline"`
	LastSeen time.Time `json:"lastSeen"`
}

// UnreadSummary provides composite unread counts for navigation badges and cards.
type UnreadSummary struct {
	TotalUnreadMessages      int            `json:"totalUnreadMessages"`
	TotalUnreadNotifications int            `json:"totalUnreadNotifications"`
	UnreadByTask             map[string]int `json:"unreadByTask"`
	UnreadByPeer             map[string]int `json:"unreadByPeer"`
}

// PublishedTaskView presents a task along with its applicants for the publisher.
type PublishedTaskView struct {
	Task
	CreatorRole string                `json:"creatorRole,omitempty"`
	Applicants  []TaskApplicationView `json:"applicants"`
}

// ApplyTaskRequest defines input to apply for a campus task.
type ApplyTaskRequest struct {
	TaskID string `json:"taskId"`
	Note   string `json:"note"`
}

// WithdrawApplicationRequest defines input to withdraw an active application.
type WithdrawApplicationRequest struct {
	ApplicationID string `json:"applicationId"`
	TaskID        string `json:"taskId"`
}

// SendMessageRequest defines input for task chat.
type SendMessageRequest struct {
	TaskID      string `json:"taskId"`
	RecipientID string `json:"recipientId"`
	Content     string `json:"content"`
}
