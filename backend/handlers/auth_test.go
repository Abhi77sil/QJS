package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"qjs-backend/database"
	"qjs-backend/models"
)

func setupTestDB(t *testing.T) *database.DB {
	tmpDir, err := os.MkdirTemp("", "qjs-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(tmpDir) })

	dbPath := filepath.Join(tmpDir, "test.db")
	db, err := database.InitDB(dbPath)
	if err != nil {
		t.Fatalf("failed to init db: %v", err)
	}
	t.Cleanup(func() { _ = db.SQL.Close() })

	return db
}

func TestSignupAndLoginFlow(t *testing.T) {
	db := setupTestDB(t)
	handler := NewAuthHandler(db)

	// 1. Successful Signup
	signupPayload := models.SignupRequest{
		Name:     "Aryan Sharma",
		Phone:    "+919876543210",
		RegNo:    "12109876",
		Email:    "aryan@lpu.in",
		Password: "Password123",
		Confirm:  "Password123",
	}
	body, _ := json.Marshal(signupPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewReader(body))
	w := httptest.NewRecorder()

	handler.Signup(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", w.Code, w.Body.String())
	}

	var signupResp models.AuthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &signupResp); err != nil {
		t.Fatalf("failed to unmarshal signup response: %v", err)
	}
	if !signupResp.Success || signupResp.Token == "" {
		t.Fatalf("expected success and token, got: %+v", signupResp)
	}
	if signupResp.User.Email != "aryan@lpu.in" {
		t.Fatalf("expected email aryan@lpu.in, got %s", signupResp.User.Email)
	}

	// 2. Duplicate Signup attempt should return 409 Conflict
	wDup := httptest.NewRecorder()
	reqDup := httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewReader(body))
	handler.Signup(wDup, reqDup)
	if wDup.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict on duplicate signup, got %d", wDup.Code)
	}

	// 3. Login with Email
	loginEmail := models.LoginRequest{
		Identifier: "aryan@lpu.in",
		Password:   "Password123",
		RememberMe: true,
	}
	bodyLog, _ := json.Marshal(loginEmail)
	wLog := httptest.NewRecorder()
	reqLog := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(bodyLog))
	handler.Login(wLog, reqLog)

	if wLog.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for login by email, got %d: %s", wLog.Code, wLog.Body.String())
	}

	var loginResp models.AuthResponse
	_ = json.Unmarshal(wLog.Body.Bytes(), &loginResp)
	if loginResp.Token == "" {
		t.Fatalf("expected login token")
	}

	// 4. Login with Registration Number
	loginReg := models.LoginRequest{
		Identifier: "12109876",
		Password:   "Password123",
	}
	bodyReg, _ := json.Marshal(loginReg)
	wReg := httptest.NewRecorder()
	reqReg := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(bodyReg))
	handler.Login(wReg, reqReg)
	if wReg.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for login by regNo, got %d", wReg.Code)
	}

	// 5. Login with Phone
	loginPhone := models.LoginRequest{
		Identifier: "+919876543210",
		Password:   "Password123",
	}
	bodyPhone, _ := json.Marshal(loginPhone)
	wPhone := httptest.NewRecorder()
	reqPhone := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(bodyPhone))
	handler.Login(wPhone, reqPhone)
	if wPhone.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for login by phone, got %d", wPhone.Code)
	}

	// 6. Login with Wrong Password -> 401
	loginBadPass := models.LoginRequest{
		Identifier: "aryan@lpu.in",
		Password:   "WrongPassword99",
	}
	bodyBadPass, _ := json.Marshal(loginBadPass)
	wBadPass := httptest.NewRecorder()
	reqBadPass := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(bodyBadPass))
	handler.Login(wBadPass, reqBadPass)
	if wBadPass.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong password, got %d", wBadPass.Code)
	}

	// 7. Check Session (/api/auth/me) with valid token
	wMe := httptest.NewRecorder()
	reqMe := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	reqMe.Header.Set("Authorization", "Bearer "+loginResp.Token)
	handler.Me(wMe, reqMe)
	if wMe.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for /api/auth/me, got %d: %s", wMe.Code, wMe.Body.String())
	}

	// 8. Logout (/api/auth/logout)
	wLogout := httptest.NewRecorder()
	reqLogout := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	reqLogout.Header.Set("Authorization", "Bearer "+loginResp.Token)
	handler.Logout(wLogout, reqLogout)
	if wLogout.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for logout, got %d", wLogout.Code)
	}

	// 9. Check Session again -> should be 401 Unauthorized after logout
	wMeRevoked := httptest.NewRecorder()
	reqMeRevoked := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	reqMeRevoked.Header.Set("Authorization", "Bearer "+loginResp.Token)
	handler.Me(wMeRevoked, reqMeRevoked)
	if wMeRevoked.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized after logout, got %d", wMeRevoked.Code)
	}
}

func TestHealthEndpoint(t *testing.T) {
	db := setupTestDB(t)
	handler := NewAuthHandler(db)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	handler.Health(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for health check, got %d", w.Code)
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["database"] != "connected" {
		t.Fatalf("expected database connected, got %v", resp["database"])
	}
}

func TestAdminAndTasksFlow(t *testing.T) {
	db := setupTestDB(t)
	handler := NewAuthHandler(db)

	// Verify IsAdminEmail
	if !IsAdminEmail("ghost@intelcore.in") {
		t.Fatalf("expected ghost@intelcore.in to be admin")
	}
	if IsAdminEmail("regular@campus.edu") {
		t.Fatalf("expected regular@campus.edu to NOT be admin")
	}

	// 1. Create a regular user
	regUser := models.SignupRequest{
		Name:     "Regular Student",
		Phone:    "+919876500001",
		RegNo:    "12000001",
		Email:    "regular@campus.edu",
		Password: "Password123",
		Confirm:  "Password123",
	}
	bodyReg, _ := json.Marshal(regUser)
	wReg := httptest.NewRecorder()
	rReg := httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewReader(bodyReg))
	handler.Signup(wReg, rReg)
	var regResp models.AuthResponse
	_ = json.Unmarshal(wReg.Body.Bytes(), &regResp)
	if regResp.User.IsAdmin {
		t.Fatalf("regular user should not have IsAdmin: true")
	}

	// 2. Create the admin user
	adminUser := models.SignupRequest{
		Name:     "Ghost Admin",
		Phone:    "+919876500002",
		RegNo:    "12000002",
		Email:    "ghost@intelcore.in",
		Password: "Password123",
		Confirm:  "Password123",
	}
	bodyAdmin, _ := json.Marshal(adminUser)
	wAdmin := httptest.NewRecorder()
	rAdmin := httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewReader(bodyAdmin))
	handler.Signup(wAdmin, rAdmin)
	var adminResp models.AuthResponse
	_ = json.Unmarshal(wAdmin.Body.Bytes(), &adminResp)
	if !adminResp.User.IsAdmin {
		t.Fatalf("admin user ghost@intelcore.in MUST have IsAdmin: true")
	}

	// 3. GET /api/tasks (public/students)
	wList := httptest.NewRecorder()
	rList := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	handler.Tasks(wList, rList)
	if wList.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GET /api/tasks, got %d", wList.Code)
	}

	// 4. Regular user attempts to POST /api/tasks -> 403 Forbidden
	taskPayload := models.CreateTaskRequest{
		Title:          "Campus Tour Guide",
		Description:    "Guide freshers across university blocks",
		Category:       "Event",
		Reward:         400,
		Difficulty:     "Easy",
		EstimatedHours: 2.0,
	}
	bodyTask, _ := json.Marshal(taskPayload)
	wNonAdminPost := httptest.NewRecorder()
	rNonAdminPost := httptest.NewRequest(http.MethodPost, "/api/tasks", bytes.NewReader(bodyTask))
	rNonAdminPost.Header.Set("Authorization", "Bearer "+regResp.Token)
	handler.Tasks(wNonAdminPost, rNonAdminPost)
	if wNonAdminPost.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for non-admin POST /api/tasks, got %d", wNonAdminPost.Code)
	}

	// 5. Admin attempts to POST /api/tasks -> 201 Created
	wAdminPost := httptest.NewRecorder()
	rAdminPost := httptest.NewRequest(http.MethodPost, "/api/tasks", bytes.NewReader(bodyTask))
	rAdminPost.Header.Set("Authorization", "Bearer "+adminResp.Token)
	handler.Tasks(wAdminPost, rAdminPost)
	if wAdminPost.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for admin POST /api/tasks, got %d: %s", wAdminPost.Code, wAdminPost.Body.String())
	}

	var createdTaskResp struct {
		Success bool        `json:"success"`
		Task    models.Task `json:"task"`
	}
	_ = json.Unmarshal(wAdminPost.Body.Bytes(), &createdTaskResp)
	if createdTaskResp.Task.ID == "" {
		t.Fatalf("expected created task to have ID")
	}

	// 6. Admin deletes the task -> 200 OK
	wDel := httptest.NewRecorder()
	rDel := httptest.NewRequest(http.MethodDelete, "/api/tasks?id="+createdTaskResp.Task.ID, nil)
	rDel.Header.Set("Authorization", "Bearer "+adminResp.Token)
	handler.Tasks(wDel, rDel)
	if wDel.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin DELETE /api/tasks, got %d", wDel.Code)
	}
}

func TestWalletAndEconomyFlow(t *testing.T) {
	db := setupTestDB(t)
	handler := NewAuthHandler(db)

	// Register user
	regUser := models.SignupRequest{
		Name:     "Kavita Patel",
		Phone:    "+919876543299",
		RegNo:    "12104599",
		Email:    "kavita@campus.edu",
		Password: "Password123",
		Confirm:  "Password123",
	}
	bodyUser, _ := json.Marshal(regUser)
	wUser := httptest.NewRecorder()
	rUser := httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewReader(bodyUser))
	handler.Signup(wUser, rUser)
	var userAuth models.AuthResponse
	_ = json.Unmarshal(wUser.Body.Bytes(), &userAuth)

	// 1. Initial wallet should be 0 Qc
	wWallet := httptest.NewRecorder()
	rWallet := httptest.NewRequest(http.MethodGet, "/api/wallet", nil)
	rWallet.Header.Set("Authorization", "Bearer "+userAuth.Token)
	handler.Wallet(wWallet, rWallet)
	if wWallet.Code != http.StatusOK {
		t.Fatalf("expected 200 for wallet, got %d", wWallet.Code)
	}
	var walletResp models.WalletResponse
	_ = json.Unmarshal(wWallet.Body.Bytes(), &walletResp)
	if walletResp.Balance != 0 || walletResp.Currency != "Qc" {
		t.Fatalf("expected initial balance 0 Qc, got %d %s", walletResp.Balance, walletResp.Currency)
	}

	// 2. Top-up invalid amount (< 10) -> 400 Bad Request
	badTopup := models.TopupRequest{Amount: 5, Method: "upi"}
	bodyBad, _ := json.Marshal(badTopup)
	wBadTopup := httptest.NewRecorder()
	rBadTopup := httptest.NewRequest(http.MethodPost, "/api/wallet/topup", bytes.NewReader(bodyBad))
	rBadTopup.Header.Set("Authorization", "Bearer "+userAuth.Token)
	handler.Topup(wBadTopup, rBadTopup)
	if wBadTopup.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for topup < 10 Qc, got %d", wBadTopup.Code)
	}

	// 3. Valid Top-up of 500 Qc
	goodTopup := models.TopupRequest{Amount: 500, Method: "upi"}
	bodyGood, _ := json.Marshal(goodTopup)
	wGoodTopup := httptest.NewRecorder()
	rGoodTopup := httptest.NewRequest(http.MethodPost, "/api/wallet/topup", bytes.NewReader(bodyGood))
	rGoodTopup.Header.Set("Authorization", "Bearer "+userAuth.Token)
	handler.Topup(wGoodTopup, rGoodTopup)
	if wGoodTopup.Code != http.StatusOK {
		t.Fatalf("expected 200 for topup, got %d: %s", wGoodTopup.Code, wGoodTopup.Body.String())
	}

	var topupSuccess struct {
		Success bool `json:"success"`
		Balance int  `json:"balance"`
	}
	_ = json.Unmarshal(wGoodTopup.Body.Bytes(), &topupSuccess)
	if topupSuccess.Balance != 500 {
		t.Fatalf("expected balance 500 Qc, got %d", topupSuccess.Balance)
	}

	// 4. Admin User adjustment
	adminUser := models.SignupRequest{
		Name:     "Ghost Admin",
		Phone:    "+919876543200",
		RegNo:    "12000000",
		Email:    "ghost@intelcore.in",
		Password: "Password123",
		Confirm:  "Password123",
	}
	bodyAdmin, _ := json.Marshal(adminUser)
	wAdmin := httptest.NewRecorder()
	rAdmin := httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewReader(bodyAdmin))
	handler.Signup(wAdmin, rAdmin)
	var adminAuth models.AuthResponse
	_ = json.Unmarshal(wAdmin.Body.Bytes(), &adminAuth)

	// Admin adjusts Kavita's wallet: +300 Qc
	adjPayload := models.WalletAdjustmentRequest{
		UserID: userAuth.User.ID,
		Amount: 300,
		Reason: "Special campus hackathon award",
	}
	bodyAdj, _ := json.Marshal(adjPayload)
	wAdj := httptest.NewRecorder()
	rAdj := httptest.NewRequest(http.MethodPost, "/api/admin/wallet/adjust", bytes.NewReader(bodyAdj))
	rAdj.Header.Set("Authorization", "Bearer "+adminAuth.Token)
	handler.AdminAdjustWallet(wAdj, rAdj)
	if wAdj.Code != http.StatusOK {
		t.Fatalf("expected 200 for admin wallet adjust, got %d: %s", wAdj.Code, wAdj.Body.String())
	}

	// 5. Economy KPIs check
	wKpis := httptest.NewRecorder()
	rKpis := httptest.NewRequest(http.MethodGet, "/api/economy/kpis", nil)
	handler.EconomyKPIsHandler(wKpis, rKpis)
	if wKpis.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/economy/kpis, got %d", wKpis.Code)
	}
	var kpiResp struct {
		CirculatingQc int `json:"circulatingQc"`
	}
	_ = json.Unmarshal(wKpis.Body.Bytes(), &kpiResp)
	if kpiResp.CirculatingQc != 800 {
		t.Fatalf("expected total circulating Qc to be 800, got %d", kpiResp.CirculatingQc)
	}
}

func TestTransferAndWithdrawFlow(t *testing.T) {
	db := setupTestDB(t)
	handler := NewAuthHandler(db)

	// 1. Create Student A (Alice)
	aliceSignup := models.SignupRequest{
		Name:     "Alice Verma",
		Phone:    "+919876500001",
		RegNo:    "12111001",
		Email:    "alice@lpu.in",
		Password: "Password123",
		Confirm:  "Password123",
	}
	bAlice, _ := json.Marshal(aliceSignup)
	wAlice := httptest.NewRecorder()
	handler.Signup(wAlice, httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewReader(bAlice)))
	var aliceAuth models.AuthResponse
	_ = json.Unmarshal(wAlice.Body.Bytes(), &aliceAuth)

	// 2. Create Student B (Bob)
	bobSignup := models.SignupRequest{
		Name:     "Bob Kumar",
		Phone:    "+919876500002",
		RegNo:    "12111002",
		Email:    "bob@lpu.in",
		Password: "Password123",
		Confirm:  "Password123",
	}
	bBob, _ := json.Marshal(bobSignup)
	wBob := httptest.NewRecorder()
	handler.Signup(wBob, httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewReader(bBob)))
	var bobAuth models.AuthResponse
	_ = json.Unmarshal(wBob.Body.Bytes(), &bobAuth)

	// 3. Alice tops up 1,000 Qc
	topupReq := models.TopupRequest{Amount: 1000, Method: "UPI"}
	bTopup, _ := json.Marshal(topupReq)
	rTopup := httptest.NewRequest(http.MethodPost, "/api/wallet/topup", bytes.NewReader(bTopup))
	rTopup.Header.Set("Authorization", "Bearer "+aliceAuth.Token)
	wTopup := httptest.NewRecorder()
	handler.Topup(wTopup, rTopup)
	if wTopup.Code != http.StatusOK {
		t.Fatalf("failed Alice topup: %d %s", wTopup.Code, wTopup.Body.String())
	}

	// 4. Alice transfers 300 Qc to Bob via RegNo
	trfReq := models.TransferRequest{
		Recipient: "12111002",
		Amount:    300,
		Note:      "Tuition assistance for Calculus",
	}
	bTrf, _ := json.Marshal(trfReq)
	rTrf := httptest.NewRequest(http.MethodPost, "/api/wallet/transfer", bytes.NewReader(bTrf))
	rTrf.Header.Set("Authorization", "Bearer "+aliceAuth.Token)
	wTrf := httptest.NewRecorder()
	handler.Transfer(wTrf, rTrf)
	if wTrf.Code != http.StatusOK {
		t.Fatalf("failed Alice transfer to Bob: %d %s", wTrf.Code, wTrf.Body.String())
	}

	// 5. Check Bob's wallet balance: should be 300
	rBobWallet := httptest.NewRequest(http.MethodGet, "/api/wallet", nil)
	rBobWallet.Header.Set("Authorization", "Bearer "+bobAuth.Token)
	wBobWallet := httptest.NewRecorder()
	handler.Wallet(wBobWallet, rBobWallet)
	var bobWResp models.WalletResponse
	_ = json.Unmarshal(wBobWallet.Body.Bytes(), &bobWResp)
	if bobWResp.Balance != 300 {
		t.Fatalf("expected Bob balance to be 300, got %d", bobWResp.Balance)
	}

	// 6. Check Alice self-transfer fails
	selfTrf := models.TransferRequest{Recipient: "alice@lpu.in", Amount: 50}
	bSelf, _ := json.Marshal(selfTrf)
	rSelf := httptest.NewRequest(http.MethodPost, "/api/wallet/transfer", bytes.NewReader(bSelf))
	rSelf.Header.Set("Authorization", "Bearer "+aliceAuth.Token)
	wSelf := httptest.NewRecorder()
	handler.Transfer(wSelf, rSelf)
	if wSelf.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for self transfer, got %d", wSelf.Code)
	}

	// 7. Check Alice overdraft transfer fails
	overdraftTrf := models.TransferRequest{Recipient: "bob@lpu.in", Amount: 9999}
	bOver, _ := json.Marshal(overdraftTrf)
	rOver := httptest.NewRequest(http.MethodPost, "/api/wallet/transfer", bytes.NewReader(bOver))
	rOver.Header.Set("Authorization", "Bearer "+aliceAuth.Token)
	wOver := httptest.NewRecorder()
	handler.Transfer(wOver, rOver)
	if wOver.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for overdraft transfer, got %d", wOver.Code)
	}

	// 8. Bob withdraws 100 Qc to UPI
	wthReq := models.WithdrawRequest{
		Amount:        100,
		Method:        "UPI",
		PayoutDetails: "bob@oksbi",
	}
	bWth, _ := json.Marshal(wthReq)
	rWth := httptest.NewRequest(http.MethodPost, "/api/wallet/withdraw", bytes.NewReader(bWth))
	rWth.Header.Set("Authorization", "Bearer "+bobAuth.Token)
	wWth := httptest.NewRecorder()
	handler.Withdraw(wWth, rWth)
	if wWth.Code != http.StatusOK {
		t.Fatalf("expected 200 for Bob withdrawal, got %d %s", wWth.Code, wWth.Body.String())
	}

	// 9. Bob tries to withdraw below minimum 50 Qc
	badWth := models.WithdrawRequest{Amount: 20, Method: "UPI", PayoutDetails: "bob@oksbi"}
	bBadWth, _ := json.Marshal(badWth)
	rBadWth := httptest.NewRequest(http.MethodPost, "/api/wallet/withdraw", bytes.NewReader(bBadWth))
	rBadWth.Header.Set("Authorization", "Bearer "+bobAuth.Token)
	wBadWth := httptest.NewRecorder()
	handler.Withdraw(wBadWth, rBadWth)
	if wBadWth.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for withdrawal < 50 Qc, got %d", wBadWth.Code)
	}

	// 10. Student Economy Summary check for Bob
	rEcon := httptest.NewRequest(http.MethodGet, "/api/student/economy", nil)
	rEcon.Header.Set("Authorization", "Bearer "+bobAuth.Token)
	wEcon := httptest.NewRecorder()
	handler.StudentEconomy(wEcon, rEcon)
	if wEcon.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/student/economy, got %d", wEcon.Code)
	}

	var econSummary models.StudentEconomySummary
	if err := json.Unmarshal(wEcon.Body.Bytes(), &econSummary); err != nil {
		t.Fatalf("failed to decode student economy summary: %v", err)
	}

	if econSummary.Balance != 200 {
		t.Fatalf("expected Bob remaining balance 200, got %d", econSummary.Balance)
	}
	if econSummary.TotalEarned != 300 {
		t.Fatalf("expected Bob total earned 300, got %d", econSummary.TotalEarned)
	}
	if econSummary.TotalWithdrawn != 100 {
		t.Fatalf("expected Bob total withdrawn 100, got %d", econSummary.TotalWithdrawn)
	}
	if len(econSummary.Transactions) < 2 {
		t.Fatalf("expected at least 2 transactions for Bob, got %d", len(econSummary.Transactions))
	}
}
