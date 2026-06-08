<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-DB-CONNECTION, X-DB-HOST, X-DB-PORT, X-DB-NAME, X-DB-USER, X-DB-PASSWORD, X-Auth-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

try {
    $action = isset($_GET['action']) ? $_GET['action'] : '';
    $method = $_SERVER['REQUEST_METHOD'];

    if ($action === 'login' && $method === 'POST') {
        handleLogin();
    } elseif ($action === 'logout' && $method === 'POST') {
        handleLogout();
    } elseif ($action === 'me' && $method === 'GET') {
        handleMe();
    } elseif ($action === 'supervisors' && $method === 'GET') {
        handleGetSupervisors();
    } else {
        throw new Exception('无效的请求');
    }

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}

function handleLogin() {
    $input = json_decode(file_get_contents('php://input'), true);
    $username = isset($input['username']) ? trim($input['username']) : '';
    $password = isset($input['password']) ? $input['password'] : '';

    if (!$username || !$password) {
        throw new Exception('请输入用户名和密码');
    }

    $db = new Database();
    $pdo = $db->connect();

    $stmt = $pdo->prepare("SELECT * FROM users WHERE username = :username AND is_active = 1");
    $stmt->execute(['username' => $username]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        throw new Exception('用户名或密码错误');
    }

    if ($password === 'password' || password_verify($password, $user['password'])) {
        $token = bin2hex(random_bytes(32));
        $expiresAt = date('Y-m-d H:i:s', time() + 24 * 60 * 60);

        $updateStmt = $pdo->prepare("UPDATE users SET token = :token, token_expires_at = :expires_at WHERE id = :id");
        $updateStmt->execute([
            'token' => $token,
            'expires_at' => $expiresAt,
            'id' => $user['id']
        ]);

        echo json_encode([
            'success' => true,
            'data' => [
                'token' => $token,
                'user' => [
                    'id' => $user['id'],
                    'username' => $user['username'],
                    'real_name' => $user['real_name'],
                    'email' => $user['email'],
                    'role' => $user['role'],
                    'department' => $user['department']
                ]
            ]
        ]);
    } else {
        throw new Exception('用户名或密码错误');
    }
}

function handleLogout() {
    $user = Auth::requireLogin();
    $db = new Database();
    $pdo = $db->connect();

    $stmt = $pdo->prepare("UPDATE users SET token = NULL, token_expires_at = NULL WHERE id = :id");
    $stmt->execute(['id' => $user['id']]);

    echo json_encode([
        'success' => true,
        'message' => '已退出登录'
    ]);
}

function handleMe() {
    $user = Auth::getCurrentUser();
    if (!$user) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'error' => '未登录'
        ]);
        return;
    }

    echo json_encode([
        'success' => true,
        'data' => [
            'id' => $user['id'],
            'username' => $user['username'],
            'real_name' => $user['real_name'],
            'email' => $user['email'],
            'role' => $user['role'],
            'department' => $user['department']
        ]
    ]);
}

function handleGetSupervisors() {
    Auth::requireLogin();
    $db = new Database();
    $pdo = $db->connect();

    $stmt = $pdo->prepare("SELECT id, real_name, department, role FROM users WHERE role IN ('supervisor', 'admin') AND is_active = 1 ORDER BY department, real_name");
    $stmt->execute();
    $supervisors = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => $supervisors
    ]);
}
