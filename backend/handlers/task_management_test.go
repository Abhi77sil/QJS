package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"qjs-backend/models"
)

func TestTaskManagementAndChatFlow(t *testing.T) {
	db := setupTestDB(t)
	handler := NewAuthHandler(db)

	// Create Poster user (ghost@intelcore.in)
	poster := &models.User{
		Email:        "ghost@intelcore.in",
		Name:         "Admin Ghost",
		RegNo:        "adm123",
		Phone:        "+919999999999",
		PasswordHash: "admin_hash",
	}
	if err := db.CreateUser(poster); err != nil {
		t.Fatalf("failed to create poster: %v", err)
	}
	posterSess, err := db.CreateSession(poster.ID, 24*time.Hour, "Test-Agent", "127.0.0.1")
	if err != nil {
		t.Fatalf("failed to create poster session: %v", err)
	}

	// Create Student applicant user
	student := &models.User{
		Email:        "student@lpu.in",
		Name:         "Rohan Verma",
		RegNo:        "12101111",
		Phone:        "+919888888888",
		PasswordHash: "student_hash",
	}
	if err := db.CreateUser(student); err != nil {
		t.Fatalf("failed to create student: %v", err)
	}
	studentSess, err := db.CreateSession(student.ID, 24*time.Hour, "Test-Agent", "127.0.0.1")
	if err != nil {
		t.Fatalf("failed to create student session: %v", err)
	}

	// Poster creates a task
	task := models.Task{
		Title:          "Need Machine Learning Notes Typed",
		Description:    "Type 5 handwritten chapters into Markdown format.",
		Category:       "Academic",
		Reward:         150,
		Difficulty:     "Medium",
		EstimatedHours: 2.5,
		CreatedBy:      poster.ID,
	}
	if err := db.CreateTask(&task); err != nil {
		t.Fatalf("failed to create task: %v", err)
	}

	// 1. Student applies for the task
	applyPayload := models.ApplyTaskRequest{
		TaskID: task.ID,
		Note:   "I have fast typing speed and know LaTeX/Markdown.",
	}
	body, _ := json.Marshal(applyPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/tasks/apply", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w := httptest.NewRecorder()
	handler.ApplyTask(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 on apply, got %d: %s", w.Code, w.Body.String())
	}

	var applyResp struct {
		Success     bool                   `json:"success"`
		Application models.TaskApplication `json:"application"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &applyResp); err != nil {
		t.Fatalf("failed to parse apply response: %v", err)
	}
	if !applyResp.Success || applyResp.Application.Status != "APPLIED" {
		t.Fatalf("expected status APPLIED, got %+v", applyResp)
	}

	// 2. Check student's applications endpoint
	req = httptest.NewRequest(http.MethodGet, "/api/student/applications", nil)
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w = httptest.NewRecorder()
	handler.StudentApplications(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for student applications, got %d: %s", w.Code, w.Body.String())
	}
	var myAppsResp struct {
		Success      bool                         `json:"success"`
		Applications []models.TaskApplicationView `json:"applications"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &myAppsResp); err != nil {
		t.Fatalf("failed to parse student applications: %v", err)
	}
	if len(myAppsResp.Applications) != 1 || myAppsResp.Applications[0].TaskID != task.ID {
		t.Fatalf("expected 1 application for task %s, got: %+v", task.ID, myAppsResp)
	}

	// 3. Poster checks published tasks with applicants
	req = httptest.NewRequest(http.MethodGet, "/api/student/published-tasks", nil)
	req.Header.Set("Authorization", "Bearer "+posterSess.Token)
	w = httptest.NewRecorder()
	handler.PublishedTasks(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for published tasks, got %d: %s", w.Code, w.Body.String())
	}
	var pubTasksResp struct {
		Success bool                       `json:"success"`
		Tasks   []models.PublishedTaskView `json:"tasks"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &pubTasksResp); err != nil {
		t.Fatalf("failed to parse published tasks: %v", err)
	}
	if len(pubTasksResp.Tasks) != 1 || len(pubTasksResp.Tasks[0].Applicants) != 1 {
		t.Fatalf("expected 1 published task with 1 applicant, got: %+v", pubTasksResp)
	}

	// 4. Student sends a message to the task publisher
	msgPayload := models.SendMessageRequest{
		TaskID:      task.ID,
		RecipientID: poster.ID,
		Content:     "Hello, I can complete this today by 6 PM.",
	}
	body, _ = json.Marshal(msgPayload)
	req = httptest.NewRequest(http.MethodPost, "/api/tasks/messages", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w = httptest.NewRecorder()
	handler.TaskMessages(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 for send message, got %d: %s", w.Code, w.Body.String())
	}

	// 5. Poster replies to student
	replyPayload := models.SendMessageRequest{
		TaskID:      task.ID,
		RecipientID: student.ID,
		Content:     "Great! Please go ahead with chapter 1 first.",
	}
	body, _ = json.Marshal(replyPayload)
	req = httptest.NewRequest(http.MethodPost, "/api/tasks/messages", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+posterSess.Token)
	w = httptest.NewRecorder()
	handler.TaskMessages(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 for reply message, got %d: %s", w.Code, w.Body.String())
	}

	// 6. Student reads the conversation
	req = httptest.NewRequest(http.MethodGet, "/api/tasks/messages?taskId="+task.ID+"&peerId="+poster.ID, nil)
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w = httptest.NewRecorder()
	handler.TaskMessages(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 reading conversation, got %d: %s", w.Code, w.Body.String())
	}
	var convoResp struct {
		Success  bool                 `json:"success"`
		Messages []models.TaskMessage `json:"messages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &convoResp); err != nil {
		t.Fatalf("failed to parse conversation: %v", err)
	}
	if len(convoResp.Messages) != 2 {
		t.Fatalf("expected 2 messages in conversation, got %d", len(convoResp.Messages))
	}

	// 7. Poster accepts application
	statusPayload := map[string]string{
		"applicationId": applyResp.Application.ID,
		"status":        "ACCEPTED",
	}
	body, _ = json.Marshal(statusPayload)
	req = httptest.NewRequest(http.MethodPost, "/api/tasks/application-status", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+posterSess.Token)
	w = httptest.NewRecorder()
	handler.UpdateApplicationStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 updating status, got %d: %s", w.Code, w.Body.String())
	}

	// 8. Student withdraws their application
	withdrawPayload := models.WithdrawApplicationRequest{
		ApplicationID: applyResp.Application.ID,
		TaskID:        task.ID,
	}
	body, _ = json.Marshal(withdrawPayload)
	req = httptest.NewRequest(http.MethodPost, "/api/tasks/withdraw", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w = httptest.NewRecorder()
	handler.WithdrawApplication(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 withdrawing application, got %d: %s", w.Code, w.Body.String())
	}

	var withdrawResp struct {
		Success     bool                   `json:"success"`
		Application models.TaskApplication `json:"application"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &withdrawResp); err != nil {
		t.Fatalf("failed to parse withdraw response: %v", err)
	}
	if withdrawResp.Application.Status != "WITHDRAWN" {
		t.Fatalf("expected status WITHDRAWN, got %s", withdrawResp.Application.Status)
	}

	// 9. Unread summary check
	req = httptest.NewRequest(http.MethodGet, "/api/unread/summary", nil)
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w = httptest.NewRecorder()
	handler.UnreadSummary(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for unread summary, got %d", w.Code)
	}
	var unreadResp struct {
		Success bool                 `json:"success"`
		Summary models.UnreadSummary `json:"summary"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &unreadResp); err != nil {
		t.Fatalf("failed to parse unread summary: %v", err)
	}
	if unreadResp.Summary.TotalUnreadMessages < 1 {
		t.Fatalf("expected student to have at least 1 unread message, got %d", unreadResp.Summary.TotalUnreadMessages)
	}

	// 10. Mark messages as read (Double Tick transition)
	readPayload := map[string]string{
		"taskId": task.ID,
		"peerId": poster.ID,
	}
	body, _ = json.Marshal(readPayload)
	req = httptest.NewRequest(http.MethodPost, "/api/tasks/messages/read", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w = httptest.NewRecorder()
	handler.MarkMessagesRead(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 marking messages as read, got %d: %s", w.Code, w.Body.String())
	}

	// 11. Check conversation again to verify isRead is true
	req = httptest.NewRequest(http.MethodGet, "/api/tasks/messages?taskId="+task.ID+"&peerId="+poster.ID, nil)
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w = httptest.NewRecorder()
	handler.TaskMessages(w, req)
	var convoAfterResp struct {
		Success  bool                 `json:"success"`
		Messages []models.TaskMessage `json:"messages"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &convoAfterResp)
	foundRead := false
	for _, m := range convoAfterResp.Messages {
		if m.SenderID == poster.ID && m.IsRead {
			foundRead = true
		}
	}
	if !foundRead {
		t.Fatalf("expected poster's message to be marked as isRead=true")
	}

	// 12. User Presence and Heartbeat
	req = httptest.NewRequest(http.MethodPost, "/api/presence/heartbeat", nil)
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w = httptest.NewRecorder()
	handler.PresenceHeartbeat(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for presence heartbeat, got %d", w.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/presence?userIds="+student.ID+","+poster.ID, nil)
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w = httptest.NewRecorder()
	handler.UserPresence(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for presence check, got %d", w.Code)
	}

	// 13. Notifications check & mark read
	req = httptest.NewRequest(http.MethodGet, "/api/notifications", nil)
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w = httptest.NewRecorder()
	handler.Notifications(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for notifications, got %d", w.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/notifications/read", nil)
	req.Header.Set("Authorization", "Bearer "+studentSess.Token)
	w = httptest.NewRecorder()
	handler.MarkNotificationsRead(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for mark notifications read, got %d", w.Code)
	}
}
