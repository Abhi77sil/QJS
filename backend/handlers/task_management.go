package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"qjs-backend/models"
)

// ApplyTask handles POST /api/tasks/apply
// Students apply for a listed campus task.
func (h *AuthHandler) ApplyTask(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	_, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid or expired session")
		return
	}

	var req models.ApplyTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.TaskID = strings.TrimSpace(req.TaskID)
	if req.TaskID == "" {
		writeError(w, http.StatusBadRequest, "Task ID is required")
		return
	}

	app, err := h.DB.ApplyForTask(user.ID, req.TaskID, req.Note)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"success":     true,
		"message":     "Successfully applied for task",
		"application": app,
	})
}

// WithdrawApplication handles POST /api/tasks/withdraw
// Students can withdraw an active application they submitted.
func (h *AuthHandler) WithdrawApplication(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	_, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid or expired session")
		return
	}

	var req models.WithdrawApplicationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.ApplicationID = strings.TrimSpace(req.ApplicationID)
	req.TaskID = strings.TrimSpace(req.TaskID)
	if req.ApplicationID == "" && req.TaskID == "" {
		writeError(w, http.StatusBadRequest, "Application ID or Task ID is required")
		return
	}

	app, err := h.DB.WithdrawTaskApplication(user.ID, req.ApplicationID, req.TaskID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":     true,
		"message":     "Application successfully withdrawn",
		"application": app,
	})
}

// StudentApplications handles GET /api/student/applications
// Returns all tasks the authenticated student has applied for.
func (h *AuthHandler) StudentApplications(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	_, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid or expired session")
		return
	}

	apps, err := h.DB.GetUserApplications(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch student applications")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":      true,
		"applications": apps,
	})
}

// PublishedTasks handles GET /api/student/published-tasks
// Returns tasks published by the authenticated user, along with applicant lists.
func (h *AuthHandler) PublishedTasks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	_, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid or expired session")
		return
	}

	tasks, err := h.DB.GetPublishedTasksWithApplicants(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch published tasks")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"tasks":   tasks,
	})
}

// UpdateApplicationStatus handles POST /api/tasks/application-status
// Allows task publisher to accept or reject an applicant.
func (h *AuthHandler) UpdateApplicationStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	_, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid or expired session")
		return
	}

	var req struct {
		ApplicationID string `json:"applicationId"`
		Status        string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.ApplicationID = strings.TrimSpace(req.ApplicationID)
	req.Status = strings.ToUpper(strings.TrimSpace(req.Status))
	if req.ApplicationID == "" || req.Status == "" {
		writeError(w, http.StatusBadRequest, "Application ID and Status are required")
		return
	}

	app, err := h.DB.UpdateApplicationStatus(user.ID, req.ApplicationID, req.Status)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":     true,
		"message":     "Application status updated to " + req.Status,
		"application": app,
	})
}

// TaskMessages handles:
// GET  /api/tasks/messages?taskId=...&peerId=... -> fetch conversation
// POST /api/tasks/messages                      -> send new message
func (h *AuthHandler) TaskMessages(w http.ResponseWriter, r *http.Request) {
	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	_, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid or expired session")
		return
	}

	switch r.Method {
	case http.MethodGet:
		taskID := strings.TrimSpace(r.URL.Query().Get("taskId"))
		peerID := strings.TrimSpace(r.URL.Query().Get("peerId"))
		if taskID == "" || peerID == "" {
			writeError(w, http.StatusBadRequest, "Parameters 'taskId' and 'peerId' are required")
			return
		}

		// Resolve peer ID if an email or identifier was given
		peer, err := h.DB.GetUserByID(peerID)
		if err != nil || peer == nil {
			peer, _ = h.DB.GetUserByIdentifier(peerID)
		}
		if peer != nil {
			peerID = peer.ID
		}

		messages, err := h.DB.GetTaskConversation(taskID, user.ID, peerID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to retrieve conversation")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"success":  true,
			"messages": messages,
		})

	case http.MethodPost:
		var req models.SendMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid message payload")
			return
		}

		req.TaskID = strings.TrimSpace(req.TaskID)
		req.RecipientID = strings.TrimSpace(req.RecipientID)
		req.Content = strings.TrimSpace(req.Content)

		if req.TaskID == "" || req.RecipientID == "" || req.Content == "" {
			writeError(w, http.StatusBadRequest, "taskId, recipientId, and content are required")
			return
		}

		// Resolve recipient ID if an email or identifier was provided
		recip, err := h.DB.GetUserByID(req.RecipientID)
		if err != nil || recip == nil {
			recip, _ = h.DB.GetUserByIdentifier(req.RecipientID)
		}
		if recip != nil {
			req.RecipientID = recip.ID
		}

		msg, err := h.DB.SendTaskMessage(req.TaskID, user.ID, req.RecipientID, req.Content)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"success": true,
			"message": msg,
		})

	default:
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// MarkMessagesRead handles POST /api/tasks/messages/read
// Marks messages in a thread addressed to the active user as read.
func (h *AuthHandler) MarkMessagesRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	_, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid or expired session")
		return
	}

	var req struct {
		TaskID string `json:"taskId"`
		PeerID string `json:"peerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.TaskID = strings.TrimSpace(req.TaskID)
	req.PeerID = strings.TrimSpace(req.PeerID)
	if req.TaskID == "" || req.PeerID == "" {
		writeError(w, http.StatusBadRequest, "taskId and peerId are required")
		return
	}

	peer, err := h.DB.GetUserByID(req.PeerID)
	if err != nil || peer == nil {
		peer, _ = h.DB.GetUserByIdentifier(req.PeerID)
	}
	if peer != nil {
		req.PeerID = peer.ID
	}

	count, err := h.DB.MarkMessagesAsRead(req.TaskID, user.ID, req.PeerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to mark messages as read")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":     true,
		"markedCount": count,
	})
}

// UserPresence handles GET /api/presence?userIds=usr_1,usr_2
// Checks online/offline status and last seen timestamp for given users.
func (h *AuthHandler) UserPresence(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token != "" {
		if _, user, err := h.DB.GetSessionAndUser(token); err == nil && user != nil {
			_ = h.DB.TouchUserPresence(user.ID)
		}
	}

	rawIDs := strings.TrimSpace(r.URL.Query().Get("userIds"))
	singleID := strings.TrimSpace(r.URL.Query().Get("userId"))

	var userIDs []string
	if rawIDs != "" {
		for _, part := range strings.Split(rawIDs, ",") {
			p := strings.TrimSpace(part)
			if p != "" {
				userIDs = append(userIDs, p)
			}
		}
	}
	if singleID != "" {
		userIDs = append(userIDs, singleID)
	}

	// Resolve identifiers (in case email or username was passed)
	var resolvedIDs []string
	for _, id := range userIDs {
		u, err := h.DB.GetUserByID(id)
		if err != nil || u == nil {
			u, _ = h.DB.GetUserByIdentifier(id)
		}
		if u != nil {
			resolvedIDs = append(resolvedIDs, u.ID)
		} else {
			resolvedIDs = append(resolvedIDs, id)
		}
	}

	presenceMap, err := h.DB.GetUsersPresence(resolvedIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch presence")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":  true,
		"presence": presenceMap,
	})
}

// PresenceHeartbeat handles POST /api/presence/heartbeat
// Clients periodically ping this to maintain active online status.
func (h *AuthHandler) PresenceHeartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	_, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid or expired session")
		return
	}

	_ = h.DB.TouchUserPresence(user.ID)

	writeJSON(w, http.StatusOK, map[string]any{
		"success":  true,
		"isOnline": true,
	})
}

// Notifications handles GET /api/notifications
// Returns in-app notification alerts for the current user.
func (h *AuthHandler) Notifications(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	_, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid or expired session")
		return
	}

	_ = h.DB.TouchUserPresence(user.ID)

	notifs, err := h.DB.GetUserNotifications(user.ID, 30)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch notifications")
		return
	}

	unreadCount := 0
	for _, n := range notifs {
		if !n.IsRead {
			unreadCount++
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":       true,
		"unreadCount":   unreadCount,
		"notifications": notifs,
	})
}

// MarkNotificationsRead handles POST /api/notifications/read
// Marks all active user's notifications as read.
func (h *AuthHandler) MarkNotificationsRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	_, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid or expired session")
		return
	}

	if err := h.DB.MarkNotificationsAsRead(user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to mark notifications as read")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "All notifications marked as read",
	})
}

// UnreadSummary handles GET /api/unread/summary
// Returns composite total unread messages, unread notifications, and per-task badge counts.
func (h *AuthHandler) UnreadSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	token := ExtractBearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	_, user, err := h.DB.GetSessionAndUser(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Invalid or expired session")
		return
	}

	_ = h.DB.TouchUserPresence(user.ID)

	summary, err := h.DB.GetUnreadSummary(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to compute unread summary")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"summary": summary,
	})
}
