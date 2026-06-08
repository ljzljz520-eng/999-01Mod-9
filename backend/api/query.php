<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-DB-CONNECTION, X-DB-HOST, X-DB-PORT, X-DB-NAME, X-DB-USER, X-DB-PASSWORD, X-Auth-Token');

// 处理 OPTIONS 请求（预检请求）
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

try {
    $facode = isset($_GET['facode']) ? $_GET['facode'] : (isset($_POST['facode']) ? $_POST['facode'] : null);
    $mode = isset($_GET['mode']) ? $_GET['mode'] : 'single';

    if ($mode === 'list') {
        handleListQuery();
    } else {
        handleSingleQuery($facode);
    }

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}

function handleSingleQuery($facode) {
    if (!$facode) {
        throw new Exception('缺少 facode 参数');
    }

    $db = new Database();
    $pdo = $db->connect();

    $stmt = $pdo->prepare("SELECT id, facode, sn, asset_name, purchase_price, purchase_date, user_name, department, location, status, created_at FROM assets WHERE facode = :facode");
    $stmt->execute(['facode' => $facode]);
    $result = $stmt->fetch(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => $result ?: null
    ]);
}

function handleListQuery() {
    $db = new Database();
    $pdo = $db->connect();

    $page = isset($_GET['page']) ? max(1, intval($_GET['page'])) : 1;
    $pageSize = isset($_GET['pageSize']) ? min(100, max(1, intval($_GET['pageSize']))) : 20;
    $offset = ($page - 1) * $pageSize;

    $whereClauses = [];
    $params = [];

    if (!empty($_GET['keyword'])) {
        $keyword = '%' . $_GET['keyword'] . '%';
        $whereClauses[] = "(facode LIKE :keyword OR sn LIKE :keyword OR asset_name LIKE :keyword OR user_name LIKE :keyword)";
        $params['keyword'] = $keyword;
    }

    if (!empty($_GET['department'])) {
        $whereClauses[] = "department = :department";
        $params['department'] = $_GET['department'];
    }

    if (!empty($_GET['status'])) {
        $whereClauses[] = "status = :status";
        $params['status'] = $_GET['status'];
    }

    $whereSql = '';
    if (!empty($whereClauses)) {
        $whereSql = 'WHERE ' . implode(' AND ', $whereClauses);
    }

    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM assets $whereSql");
    $countStmt->execute($params);
    $total = $countStmt->fetchColumn();

    $sql = "SELECT id, facode, sn, asset_name, purchase_price, purchase_date, user_name, department, location, status 
            FROM assets $whereSql 
            ORDER BY id DESC 
            LIMIT :offset, :pageSize";
    
    $stmt = $pdo->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value);
    }
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->bindValue(':pageSize', $pageSize, PDO::PARAM_INT);
    $stmt->execute();
    $data = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stmt = $pdo->query("SELECT DISTINCT department FROM assets WHERE department IS NOT NULL ORDER BY department");
    $departments = $stmt->fetchAll(PDO::FETCH_COLUMN);

    echo json_encode([
        'success' => true,
        'data' => [
            'list' => $data,
            'total' => intval($total),
            'page' => $page,
            'pageSize' => $pageSize,
            'departments' => $departments
        ]
    ]);
}
