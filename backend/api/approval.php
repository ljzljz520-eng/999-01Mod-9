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
require_once __DIR__ . '/export.php';

try {
    $action = isset($_GET['action']) ? $_GET['action'] : '';
    $method = $_SERVER['REQUEST_METHOD'];

    if ($action === 'list' && $method === 'GET') {
        handleApprovalList();
    } elseif ($action === 'approve' && $method === 'POST') {
        handleApprove();
    } elseif ($action === 'reject' && $method === 'POST') {
        handleReject();
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

function handleApprovalList() {
    $user = Auth::requireRole(['supervisor', 'admin']);
    $db = new Database();
    $pdo = $db->connect();

    $page = isset($_GET['page']) ? max(1, intval($_GET['page'])) : 1;
    $pageSize = isset($_GET['pageSize']) ? min(100, max(1, intval($_GET['pageSize']))) : 20;
    $offset = ($page - 1) * $pageSize;
    $status = isset($_GET['status']) ? $_GET['status'] : '';

    $whereClauses = ["supervisor_id = :supervisor_id"];
    $params = ['supervisor_id' => $user['id']];

    if ($status) {
        $whereClauses[] = "a.status = :status";
        $params['status'] = $status;
    }

    $whereSql = implode(' AND ', $whereClauses);

    $countStmt = $pdo->prepare("
        SELECT COUNT(*) 
        FROM approvals a
        WHERE $whereSql
    ");
    $countStmt->execute($params);
    $total = $countStmt->fetchColumn();

    $stmt = $pdo->prepare("
        SELECT a.*,
               er.export_token,
               er.fields,
               er.purpose as export_purpose,
               er.file_format,
               er.expires_at
        FROM approvals a
        INNER JOIN export_records er ON a.export_record_id = er.id
        WHERE $whereSql
        ORDER BY a.id DESC
        LIMIT :offset, :pageSize
    ");

    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value);
    }
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->bindValue(':pageSize', $pageSize, PDO::PARAM_INT);
    $stmt->execute();
    $approvals = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $formattedApprovals = array_map('formatApprovalRecord', $approvals);

    echo json_encode([
        'success' => true,
        'data' => [
            'list' => $formattedApprovals,
            'total' => intval($total),
            'page' => $page,
            'pageSize' => $pageSize
        ]
    ]);
}

function handleApprove() {
    $user = Auth::requireRole(['supervisor', 'admin']);
    $input = json_decode(file_get_contents('php://input'), true);

    $approvalId = isset($input['approval_id']) ? intval($input['approval_id']) : (isset($input['id']) ? intval($input['id']) : 0);
    $comment = isset($input['comment']) ? trim($input['comment']) : '';

    if (!$approvalId) {
        throw new Exception('缺少审批ID');
    }

    $db = new Database();
    $pdo = $db->connect();

    $stmt = $pdo->prepare("
        SELECT a.*, er.*
        FROM approvals a
        INNER JOIN export_records er ON a.export_record_id = er.id
        WHERE a.id = :approval_id AND a.supervisor_id = :supervisor_id
    ");
    $stmt->execute([
        'approval_id' => $approvalId,
        'supervisor_id' => $user['id']
    ]);
    $approval = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$approval) {
        throw new Exception('审批记录不存在或无权限');
    }

    if ($approval['status'] !== 'pending') {
        throw new Exception('该审批已处理，不可重复操作');
    }

    $pdo->beginTransaction();

    try {
        $approvedAt = date('Y-m-d H:i:s');

        $updateApprovalStmt = $pdo->prepare("
            UPDATE approvals 
            SET status = 'approved', approval_comment = :comment, approved_at = :approved_at 
            WHERE id = :id
        ");
        $updateApprovalStmt->execute([
            'comment' => $comment,
            'approved_at' => $approvedAt,
            'id' => $approvalId
        ]);

        $updateExportStmt = $pdo->prepare("UPDATE export_records SET status = 'approved' WHERE id = :id");
        $updateExportStmt->execute(['id' => $approval['export_record_id']]);

        $fields = json_decode($approval['fields'], true);
        $filters = json_decode($approval['filters'], true);

        $exportUserStmt = $pdo->prepare("SELECT * FROM users WHERE id = :id");
        $exportUserStmt->execute(['id' => $approval['user_id']]);
        $exportUser = $exportUserStmt->fetch(PDO::FETCH_ASSOC);

        generateExportFile(
            $pdo,
            $approval['export_record_id'],
            $fields,
            $filters,
            $exportUser,
            $approval['purpose'],
            $approval['file_format']
        );

        Auth::logAudit($approval['export_record_id'], $user['id'], $user['real_name'], 'approve', [
            'approval_id' => $approvalId,
            'comment' => $comment,
            'applicant' => $approval['applicant_name']
        ]);

        $pdo->commit();

        echo json_encode([
            'success' => true,
            'message' => '审批通过，导出文件已生成'
        ]);

    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function handleReject() {
    $user = Auth::requireRole(['supervisor', 'admin']);
    $input = json_decode(file_get_contents('php://input'), true);

    $approvalId = isset($input['approval_id']) ? intval($input['approval_id']) : (isset($input['id']) ? intval($input['id']) : 0);
    $comment = isset($input['comment']) ? trim($input['comment']) : '';

    if (!$approvalId) {
        throw new Exception('缺少审批ID');
    }

    if (empty($comment)) {
        throw new Exception('请填写驳回原因');
    }

    $db = new Database();
    $pdo = $db->connect();

    $stmt = $pdo->prepare("
        SELECT a.*
        FROM approvals a
        WHERE a.id = :approval_id AND a.supervisor_id = :supervisor_id
    ");
    $stmt->execute([
        'approval_id' => $approvalId,
        'supervisor_id' => $user['id']
    ]);
    $approval = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$approval) {
        throw new Exception('审批记录不存在或无权限');
    }

    if ($approval['status'] !== 'pending') {
        throw new Exception('该审批已处理，不可重复操作');
    }

    $pdo->beginTransaction();

    try {
        $approvedAt = date('Y-m-d H:i:s');

        $updateApprovalStmt = $pdo->prepare("
            UPDATE approvals 
            SET status = 'rejected', approval_comment = :comment, approved_at = :approved_at 
            WHERE id = :id
        ");
        $updateApprovalStmt->execute([
            'comment' => $comment,
            'approved_at' => $approvedAt,
            'id' => $approvalId
        ]);

        $updateExportStmt = $pdo->prepare("UPDATE export_records SET status = 'rejected' WHERE id = :id");
        $updateExportStmt->execute(['id' => $approval['export_record_id']]);

        Auth::logAudit($approval['export_record_id'], $user['id'], $user['real_name'], 'reject', [
            'approval_id' => $approvalId,
            'comment' => $comment,
            'applicant' => $approval['applicant_name']
        ]);

        $pdo->commit();

        echo json_encode([
            'success' => true,
            'message' => '已驳回导出申请'
        ]);

    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function formatApprovalRecord($record) {
    $highSensFields = json_decode($record['high_sensitivity_fields'], true);
    if (!is_array($highSensFields)) {
        $highSensFields = [];
    }
    $highSensFields = array_values($highSensFields);
    $highSensLabels = Auth::getHighSensitivityFieldLabels();

    $fieldDisplay = array_map(function($field) use ($highSensLabels) {
        return [
            'key' => $field,
            'label' => isset($highSensLabels[$field]) ? $highSensLabels[$field] : $field
        ];
    }, $highSensFields);

    $isExpired = strtotime($record['expires_at']) < time();

    return [
        'id' => intval($record['id']),
        'export_record_id' => intval($record['export_record_id']),
        'export_token' => $record['export_token'],
        'applicant_id' => intval($record['applicant_id']),
        'applicant_name' => $record['applicant_name'],
        'supervisor_id' => intval($record['supervisor_id']),
        'supervisor_name' => $record['supervisor_name'],
        'high_sensitivity_fields' => $fieldDisplay,
        'purpose' => $record['purpose'],
        'file_format' => $record['file_format'],
        'status' => $record['status'],
        'approval_comment' => $record['approval_comment'],
        'approved_at' => $record['approved_at'],
        'is_expired' => $isExpired,
        'created_at' => $record['created_at']
    ];
}
