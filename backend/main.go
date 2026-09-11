package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"qjs-backend/database"
	"qjs-backend/handlers"
	"qjs-backend/middleware"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "7777"
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		if _, err := os.Stat(filepath.Join("backend", "data")); err == nil {
			dbPath = filepath.Join("backend", "data", "qjs.db")
		} else {
			dbPath = filepath.Join(".", "data", "qjs.db")
		}
	}

	log.Println("[INIT] Starting Quick Jobs Backend Service...")

	// Initialize SQLite Database
	db, err := database.InitDB(dbPath)
	if err != nil {
		log.Fatalf("[FATAL] Could not initialize database: %v", err)
	}
	defer db.SQL.Close()

	// Periodic session cleanup worker
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()
	go func() {
		for range ticker.C {
			if count, err := db.CleanExpiredSessions(); err == nil && count > 0 {
				log.Printf("[CLEANUP] Purged %d expired sessions", count)
			}
		}
	}()

	authHandler := handlers.NewAuthHandler(db)

	// Build API router
	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", authHandler.Health)
	mux.HandleFunc("/api/auth/signup", authHandler.Signup)
	mux.HandleFunc("/api/auth/login", authHandler.Login)
	mux.HandleFunc("/api/auth/me", authHandler.Me)
	mux.HandleFunc("/api/auth/logout", authHandler.Logout)
	mux.HandleFunc("/api/tasks", authHandler.Tasks)
	mux.HandleFunc("/api/tasks/apply", authHandler.ApplyTask)
	mux.HandleFunc("/api/tasks/withdraw", authHandler.WithdrawApplication)
	mux.HandleFunc("/api/student/applications", authHandler.StudentApplications)
	mux.HandleFunc("/api/student/published-tasks", authHandler.PublishedTasks)
	mux.HandleFunc("/api/tasks/application-status", authHandler.UpdateApplicationStatus)
	mux.HandleFunc("/api/tasks/messages", authHandler.TaskMessages)
	mux.HandleFunc("/api/tasks/messages/read", authHandler.MarkMessagesRead)
	mux.HandleFunc("/api/presence", authHandler.UserPresence)
	mux.HandleFunc("/api/presence/heartbeat", authHandler.PresenceHeartbeat)
	mux.HandleFunc("/api/notifications", authHandler.Notifications)
	mux.HandleFunc("/api/notifications/read", authHandler.MarkNotificationsRead)
	mux.HandleFunc("/api/unread/summary", authHandler.UnreadSummary)

	// Wallet & Qc Currency
	mux.HandleFunc("/api/wallet", authHandler.Wallet)
	mux.HandleFunc("/api/wallet/topup", authHandler.Topup)
	mux.HandleFunc("/api/wallet/transfer", authHandler.Transfer)
	mux.HandleFunc("/api/wallet/withdraw", authHandler.Withdraw)
	mux.HandleFunc("/api/student/economy", authHandler.StudentEconomy)
	mux.HandleFunc("/api/transactions", authHandler.Transactions)

	// Admin Dedicated Endpoints
	mux.HandleFunc("/api/admin/users", authHandler.AdminUsers)
	mux.HandleFunc("/api/admin/wallet/adjust", authHandler.AdminAdjustWallet)
	mux.HandleFunc("/api/admin/economy", authHandler.EconomyKPIsHandler)

	// Economy Integration Endpoints
	mux.HandleFunc("/api/economy/kpis", authHandler.EconomyKPIsHandler)
	mux.HandleFunc("/api/fraud/signals", authHandler.EconomyFeedFallbacks)
	mux.HandleFunc("/api/reputation/leaders", authHandler.EconomyFeedFallbacks)
	mux.HandleFunc("/api/rewards/summary", authHandler.EconomyFeedFallbacks)
	mux.HandleFunc("/api/disputes", authHandler.EconomyFeedFallbacks)
	mux.HandleFunc("/api/revenue/mix", authHandler.EconomyFeedFallbacks)
	mux.HandleFunc("/api/economy/chart", authHandler.EconomyFeedFallbacks)

	// Static file serving for workspace root so app can run all-in-one
	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		// Parent directory is workspace root
		staticDir = ".."
	}

	fs := http.FileServer(http.Dir(staticDir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		fs.ServeHTTP(w, r)
	})

	// Wrap handler with CORS and Logger
	handler := middleware.CORS(middleware.Logger(mux))

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown channel
	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("[SERVER] Quick Jobs backend listening on http://localhost:%s", port)
		log.Printf("[SERVER] Health check: http://localhost:%s/api/health", port)
		log.Printf("[SERVER] Serving static assets from: %s", staticDir)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[FATAL] Server error: %v", err)
		}
	}()

	<-stopChan
	log.Println("[SERVER] Shutting down gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("[SERVER] Shutdown error: %v", err)
	}

	fmt.Println("[SERVER] Stopped.")
}
