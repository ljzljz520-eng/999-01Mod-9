<?php
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
    $token = isset($_GET['token']) ? $_GET['token'] : '';

    if (!$token) {
        throw new Exception('缺少下载令牌');
    }

    $user = Auth::requireLogin();
    $db = new Database();
    $pdo = $db->connect();

    $stmt = $pdo->prepare("SELECT * FROM export_records WHERE export_token = :token");
    $stmt->execute(['token' => $token]);
    $record = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$record) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'error' => '下载链接无效或已失效'
        ]);
        exit;
    }

    if ($record['user_id'] !== $user['id']) {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'error' => '您没有权限下载此文件'
        ]);
        exit;
    }

    if ($record['status'] === 'pending') {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => '导出申请正在审批中，请等待审批通过后再下载'
        ]);
        exit;
    }

    if ($record['status'] === 'rejected') {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => '导出申请已被驳回，无法下载'
        ]);
        exit;
    }

    if (strtotime($record['expires_at']) < time()) {
        if ($record['status'] !== 'expired') {
            $updateStmt = $pdo->prepare("UPDATE export_records SET status = 'expired' WHERE id = :id");
            $updateStmt->execute(['id' => $record['id']]);
            Auth::logAudit($record['id'], $user['id'], $user['real_name'], 'expire', []);
        }

        http_response_code(410);
        echo json_encode([
            'success' => false,
            'error' => '下载链接已过期，请重新申请导出'
        ]);
        exit;
    }

    if ($record['download_count'] >= $record['max_downloads']) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => '下载次数已达上限（' . $record['max_downloads'] . '次），请重新申请导出'
        ]);
        exit;
    }

    if (empty($record['file_path']) || !file_exists($record['file_path'])) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'error' => '文件不存在或已被删除'
        ]);
        exit;
    }

    $pdo->beginTransaction();

    try {
        $newDownloadCount = $record['download_count'] + 1;
        $updateStmt = $pdo->prepare("UPDATE export_records SET download_count = :download_count WHERE id = :id");
        $updateStmt->execute([
            'download_count' => $newDownloadCount,
            'id' => $record['id']
        ]);

        Auth::logAudit($record['id'], $user['id'], $user['real_name'], 'download', [
            'download_count' => $newDownloadCount,
            'max_downloads' => $record['max_downloads'],
            'file_name' => $record['file_name']
        ]);

        $pdo->commit();

    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }

    $filePath = $record['file_path'];
    $fileName = $record['file_name'] ?: 'assets_export.' . $record['file_format'];
    $fileSize = filesize($filePath);

    header('Content-Description: File Transfer');
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . $fileName . '"');
    header('Content-Transfer-Encoding: binary');
    header('Expires: 0');
    header('Cache-Control: must-revalidate');
    header('Pragma: public');
    header('Content-Length: ' . $fileSize);

    readfile($filePath);
    exit;

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
