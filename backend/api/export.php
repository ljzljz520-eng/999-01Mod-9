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

if (__FILE__ == $_SERVER['SCRIPT_FILENAME']) {
    try {
        $action = isset($_GET['action']) ? $_GET['action'] : '';
        $method = $_SERVER['REQUEST_METHOD'];

        if ($action === 'request' && $method === 'POST') {
            handleExportRequest();
        } elseif ($action === 'list' && $method === 'GET') {
            handleExportList();
        } elseif ($action === 'fields' && $method === 'GET') {
            handleGetFields();
        } elseif ($action === 'detail' && $method === 'GET') {
            handleExportDetail();
        } elseif ($action === 'cancel' && $method === 'POST') {
            handleCancelExport();
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
}

function handleExportRequest() {
    $user = Auth::requireLogin();
    $input = json_decode(file_get_contents('php://input'), true);

    $fields = isset($input['fields']) ? $input['fields'] : [];
    $purpose = isset($input['purpose']) ? trim($input['purpose']) : '';
    $fileFormat = isset($input['format']) ? $input['format'] : 'csv';
    $filters = isset($input['filters']) ? $input['filters'] : [];
    $supervisorId = isset($input['supervisor_id']) ? intval($input['supervisor_id']) : 0;

    if (empty($fields)) {
        throw new Exception('请选择要导出的字段');
    }

    if (empty($purpose)) {
        throw new Exception('请填写导出用途');
    }

    if (mb_strlen($purpose) > 500) {
        throw new Exception('导出用途不能超过500字');
    }

    $allowedFormats = ['csv', 'excel'];
    if (!in_array($fileFormat, $allowedFormats)) {
        throw new Exception('不支持的文件格式');
    }

    $db = new Database();
    $pdo = $db->connect();

    $requiresApproval = Auth::checkHighSensitivityFields($fields);
    $highSensFields = array_values(array_intersect($fields, Auth::getHighSensitivityFields()));
    $exportToken = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', time() + Auth::getExportExpireHours() * 3600);
    $status = $requiresApproval ? 'pending' : 'approved';

    $pdo->beginTransaction();

    try {
        $stmt = $pdo->prepare("
            INSERT INTO export_records 
            (export_token, user_id, user_name, purpose, fields, filters, file_format, 
            total_count, download_count, max_downloads, expires_at, status, requires_approval)
            VALUES 
            (:export_token, :user_id, :user_name, :purpose, :fields, :filters, :file_format,
            0, 0, :max_downloads, :expires_at, :status, :requires_approval)
        ");

        $stmt->execute([
            'export_token' => $exportToken,
            'user_id' => $user['id'],
            'user_name' => $user['real_name'],
            'purpose' => $purpose,
            'fields' => json_encode($fields, JSON_UNESCAPED_UNICODE),
            'filters' => json_encode($filters, JSON_UNESCAPED_UNICODE),
            'file_format' => $fileFormat,
            'max_downloads' => Auth::getMaxDownloads(),
            'expires_at' => $expiresAt,
            'status' => $status,
            'requires_approval' => $requiresApproval ? 1 : 0
        ]);

        $exportRecordId = $pdo->lastInsertId();

        $approvalId = null;
        if ($requiresApproval) {
            if (!$supervisorId) {
                throw new Exception('导出包含高敏字段，请选择审批主管');
            }

            $supervisorStmt = $pdo->prepare("SELECT real_name FROM users WHERE id = :id AND role IN ('supervisor', 'admin') AND is_active = 1");
            $supervisorStmt->execute(['id' => $supervisorId]);
            $supervisor = $supervisorStmt->fetch(PDO::FETCH_ASSOC);

            if (!$supervisor) {
                throw new Exception('所选主管不存在或无审批权限');
            }

            $approvalStmt = $pdo->prepare("
                INSERT INTO approvals 
                (export_record_id, applicant_id, applicant_name, supervisor_id, supervisor_name, high_sensitivity_fields, purpose, status)
                VALUES 
                (:export_record_id, :applicant_id, :applicant_name, :supervisor_id, :supervisor_name, :high_sensitivity_fields, :purpose, 'pending')
            ");

            $approvalStmt->execute([
                'export_record_id' => $exportRecordId,
                'applicant_id' => $user['id'],
                'applicant_name' => $user['real_name'],
                'supervisor_id' => $supervisorId,
                'supervisor_name' => $supervisor['real_name'],
                'high_sensitivity_fields' => json_encode($highSensFields, JSON_UNESCAPED_UNICODE),
                'purpose' => $purpose
            ]);

            $approvalId = $pdo->lastInsertId();

            $updateStmt = $pdo->prepare("UPDATE export_records SET approval_id = :approval_id WHERE id = :id");
            $updateStmt->execute(['approval_id' => $approvalId, 'id' => $exportRecordId]);

            Auth::logAudit($exportRecordId, $user['id'], $user['real_name'], 'create', [
                'fields' => $fields,
                'high_sensitivity_fields' => $highSensFields,
                'purpose' => $purpose,
                'supervisor' => $supervisor['real_name'],
                'requires_approval' => true
            ]);
        } else {
            $totalCount = countExportData($pdo, $filters);
            
            $updateStmt = $pdo->prepare("UPDATE export_records SET total_count = :total_count WHERE id = :id");
            $updateStmt->execute(['total_count' => $totalCount, 'id' => $exportRecordId]);

            generateExportFile($pdo, $exportRecordId, $fields, $filters, $user, $purpose, $fileFormat);

            Auth::logAudit($exportRecordId, $user['id'], $user['real_name'], 'create', [
                'fields' => $fields,
                'purpose' => $purpose,
                'total_count' => $totalCount,
                'requires_approval' => false
            ]);
        }

        $pdo->commit();

        $recordStmt = $pdo->prepare("SELECT * FROM export_records WHERE id = :id");
        $recordStmt->execute(['id' => $exportRecordId]);
        $record = $recordStmt->fetch(PDO::FETCH_ASSOC);

        echo json_encode([
            'success' => true,
            'data' => [
                'export_record' => formatExportRecord($record),
                'requires_approval' => $requiresApproval,
                'message' => $requiresApproval ? '导出申请已提交，等待主管审批' : '导出成功，链接已生成'
            ]
        ]);

    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function handleExportList() {
    $user = Auth::requireLogin();
    $db = new Database();
    $pdo = $db->connect();

    $page = isset($_GET['page']) ? max(1, intval($_GET['page'])) : 1;
    $pageSize = isset($_GET['pageSize']) ? min(100, max(1, intval($_GET['pageSize']))) : 20;
    $offset = ($page - 1) * $pageSize;
    $status = isset($_GET['status']) ? $_GET['status'] : '';

    $whereClauses = ["er.user_id = :user_id"];
    $params = ['user_id' => $user['id']];

    if ($status) {
        $whereClauses[] = "er.status = :status";
        $params['status'] = $status;
    }

    $whereSql = implode(' AND ', $whereClauses);

    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM export_records er WHERE $whereSql");
    $countStmt->execute($params);
    $total = $countStmt->fetchColumn();

    $stmt = $pdo->prepare("
        SELECT er.*, 
               a.status as approval_status,
               a.supervisor_name,
               a.approval_comment,
               a.approved_at
        FROM export_records er
        LEFT JOIN approvals a ON er.approval_id = a.id
        WHERE $whereSql
        ORDER BY er.id DESC
        LIMIT :offset, :pageSize
    ");

    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value);
    }
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->bindValue(':pageSize', $pageSize, PDO::PARAM_INT);
    $stmt->execute();
    $records = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $formattedRecords = array_map('formatExportRecord', $records);

    echo json_encode([
        'success' => true,
        'data' => [
            'list' => $formattedRecords,
            'total' => intval($total),
            'page' => $page,
            'pageSize' => $pageSize
        ]
    ]);
}

function handleGetFields() {
    Auth::requireLogin();

    $fieldLabels = Auth::getFieldLabels();
    $highSensFields = Auth::getHighSensitivityFields();
    $highSensLabels = Auth::getHighSensitivityFieldLabels();

    $fields = [];
    foreach ($fieldLabels as $key => $label) {
        $fields[] = [
            'key' => $key,
            'label' => $label,
            'high_sensitivity' => in_array($key, $highSensFields),
            'high_sensitivity_label' => isset($highSensLabels[$key]) ? $highSensLabels[$key] : null
        ];
    }

    echo json_encode([
        'success' => true,
        'data' => [
            'fields' => $fields,
            'high_sensitivity_fields' => $highSensFields
        ]
    ]);
}

function handleExportDetail() {
    $user = Auth::requireLogin();
    $exportToken = isset($_GET['token']) ? $_GET['token'] : '';

    if (!$exportToken) {
        throw new Exception('缺少导出令牌');
    }

    $db = new Database();
    $pdo = $db->connect();

    $stmt = $pdo->prepare("
        SELECT er.*,
               a.status as approval_status,
               a.supervisor_name,
               a.approval_comment,
               a.approved_at,
               a.high_sensitivity_fields,
               a.applicant_name
        FROM export_records er
        LEFT JOIN approvals a ON er.approval_id = a.id
        WHERE er.export_token = :token AND er.user_id = :user_id
    ");

    $stmt->execute(['token' => $exportToken, 'user_id' => $user['id']]);
    $record = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$record) {
        throw new Exception('导出记录不存在');
    }

    $auditStmt = $pdo->prepare("
        SELECT * FROM export_audit_logs WHERE export_record_id = :id ORDER BY id DESC");
    $auditStmt->execute(['id' => $record['id']]);
    $auditLogs = $auditStmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => [
            'record' => formatExportRecord($record),
            'audit_logs' => $auditLogs
        ]
    ]);
}

function handleCancelExport() {
    $user = Auth::requireLogin();
    $input = json_decode(file_get_contents('php://input'), true);
    $exportToken = isset($input['token']) ? $input['token'] : '';

    if (!$exportToken) {
        throw new Exception('缺少导出令牌');
    }

    $db = new Database();
    $pdo = $db->connect();

    $stmt = $pdo->prepare("SELECT * FROM export_records WHERE export_token = :token AND user_id = :user_id");
    $stmt->execute(['token' => $exportToken, 'user_id' => $user['id']]);
    $record = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$record) {
        throw new Exception('导出记录不存在');
    }

    if ($record['status'] !== 'pending') {
        throw new Exception('仅可取消待审批的导出申请');
    }

    $pdo->beginTransaction();

    try {
        $updateStmt = $pdo->prepare("UPDATE export_records SET status = 'rejected' WHERE id = :id");
        $updateStmt->execute(['id' => $record['id']]);

        if ($record['approval_id']) {
            $approvalStmt = $pdo->prepare("UPDATE approvals SET status = 'rejected' WHERE id = :id");
            $approvalStmt->execute(['id' => $record['approval_id']]);
        }

        Auth::logAudit($record['id'], $user['id'], $user['real_name'], 'cancel', []);

        $pdo->commit();

        echo json_encode([
            'success' => true,
            'message' => '已取消导出申请'
        ]);

    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function countExportData($pdo, $filters) {
    $whereClauses = [];
    $params = [];

    if (!empty($filters['keyword'])) {
        $keyword = '%' . $filters['keyword'] . '%';
        $whereClauses[] = "(facode LIKE :keyword OR sn LIKE :keyword OR asset_name LIKE :keyword OR user_name LIKE :keyword)";
        $params['keyword'] = $keyword;
    }

    if (!empty($filters['department'])) {
        $whereClauses[] = "department = :department";
        $params['department'] = $filters['department'];
    }

    if (!empty($filters['status'])) {
        $whereClauses[] = "status = :status";
        $params['status'] = $filters['status'];
    }

    $whereSql = '';
    if (!empty($whereClauses)) {
        $whereSql = 'WHERE ' . implode(' AND ', $whereClauses);
    }

    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM assets $whereSql");
    $countStmt->execute($params);
    return intval($countStmt->fetchColumn());
}

function generateExportFile($pdo, $exportRecordId, $fields, $filters, $user, $purpose, $fileFormat) {
    $exportDir = __DIR__ . '/../exports';
    if (!is_dir($exportDir)) {
        mkdir($exportDir, 0755, true);
    }

    $whereClauses = [];
    $params = [];

    if (!empty($filters['keyword'])) {
        $keyword = '%' . $filters['keyword'] . '%';
        $whereClauses[] = "(facode LIKE :keyword OR sn LIKE :keyword OR asset_name LIKE :keyword OR user_name LIKE :keyword)";
        $params['keyword'] = $keyword;
    }

    if (!empty($filters['department'])) {
        $whereClauses[] = "department = :department";
        $params['department'] = $filters['department'];
    }

    if (!empty($filters['status'])) {
        $whereClauses[] = "status = :status";
        $params['status'] = $filters['status'];
    }

    $whereSql = '';
    if (!empty($whereClauses)) {
        $whereSql = 'WHERE ' . implode(' AND ', $whereClauses);
    }

    $fieldLabels = Auth::getFieldLabels();
    $selectFields = implode(', ', $fields);
    $sql = "SELECT $selectFields FROM assets $whereSql ORDER BY id DESC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $data = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $exportToken = bin2hex(random_bytes(16));
    $fileName = "assets_export_{$exportToken}";

    if ($fileFormat === 'csv') {
        $filePath = generateCsvWithWatermark($exportDir, $fileName, $data, $fields, $fieldLabels, $user, $purpose);
    } else {
        $filePath = generateExcelWithWatermark($exportDir, $fileName, $data, $fields, $fieldLabels, $user, $purpose);
    }

    $displayFileName = "固定资产导出_" . date('YmdHis') . "." . $fileFormat;
    $recordCount = count($data);

    $updateStmt = $pdo->prepare("UPDATE export_records SET file_path = :file_path, file_name = :file_name, total_count = :total_count WHERE id = :id");
    $updateStmt->execute([
        'file_path' => $filePath,
        'file_name' => $displayFileName,
        'total_count' => $recordCount,
        'id' => $exportRecordId
    ]);

    return $filePath;
}

function generateCsvWithWatermark($exportDir, $fileName, $data, $fields, $fieldLabels, $user, $purpose) {
    $filePath = $exportDir . '/' . $fileName . '.csv';
    $fp = fopen($filePath, 'w');

    $watermarkLines = generateWatermarkLines($user, $purpose, count($data));
    fwrite($fp, "\xEF\xBB\xBF");
    foreach ($watermarkLines as $line) {
        fwrite($fp, $line . "\n");
    }
    fwrite($fp, "\n");

    $headers = array_map(function($field) use ($fieldLabels) {
        return isset($fieldLabels[$field]) ? $fieldLabels[$field] : $field;
    }, $fields);
    fputcsv($fp, $headers);

    foreach ($data as $row) {
        $output = [];
        foreach ($fields as $field) {
            $value = $row[$field] ?? '';
            if ($field === 'purchase_price' && $value !== '') {
                $value = number_format(floatval($value), 2, '.', '');
            }
            $output[] = $value;
        }
        fputcsv($fp, $output);
    }

    fclose($fp);
    return $filePath;
}

function generateExcelWithWatermark($exportDir, $fileName, $data, $fields, $fieldLabels, $user, $purpose) {
    $filePath = $exportDir . '/' . $fileName . '.xls';
    $fp = fopen($filePath, 'w');

    $watermarkLines = generateWatermarkLines($user, $purpose, count($data));

    $html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
    $html .= '<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>';

    $html .= '<div style="border: 2px solid #ff6b6b; padding: 15px; margin-bottom: 20px; background: #fff5f5;">';
    $html .= '<h2 style="color: #c92a2a; margin: 0 0 10px 0; font-size: 16px;">⚠️ 机密文件 - 导出审计水印</h2>';
    foreach ($watermarkLines as $line) {
        $html .= '<p style="margin: 5px 0; font-size: 12px; color: #868e96;">' . htmlspecialchars($line) . '</p>';
    }
    $html .= '</div>';

    $html .= '<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">';
    $html .= '<tr style="background-color: #f1f3f5; font-weight: bold;">';
    foreach ($fields as $field) {
        $label = isset($fieldLabels[$field]) ? $fieldLabels[$field] : $field;
        $html .= '<th style="padding: 8px; border: 1px solid #dee2e6;">' . htmlspecialchars($label) . '</th>';
    }
    $html .= '</tr>';

    foreach ($data as $row) {
        $html .= '<tr>';
        foreach ($fields as $field) {
            $value = $row[$field] ?? '';
            if ($field === 'purchase_price' && $value !== '') {
                $value = number_format(floatval($value), 2, '.', '');
            }
            $html .= '<td style="padding: 6px; border: 1px solid #dee2e6;">' . htmlspecialchars($value) . '</td>';
        }
        $html .= '</tr>';
    }

    $html .= '</table></body></html>';

    fwrite($fp, $html);
    fclose($fp);
    return $filePath;
}

function generateWatermarkLines($user, $purpose, $recordCount) {
    $now = date('Y-m-d H:i:s');
    $ip = Auth::getClientIp();
    $expireHours = Auth::getExportExpireHours();
    $expiresAt = date('Y-m-d H:i:s', time() + $expireHours * 3600);

    return [
        '======================================================================',
        '【导出审计水印】',
        '导出人: ' . $user['real_name'] . ' (用户名: ' . $user['username'] . ')',
        '导出时间: ' . $now,
        '导出用途: ' . $purpose,
        '导出IP: ' . $ip,
        '导出记录数: ' . $recordCount . ' 条',
        '链接有效期: ' . $expireHours . ' 小时 (至 ' . $expiresAt . ' 过期)',
        '保密声明: 本文件包含敏感信息，仅限授权人员使用，严禁泄露或转发',
        '======================================================================'
    ];
}

function formatExportRecord($record) {
    $fields = json_decode($record['fields'], true);
    $fieldLabels = Auth::getFieldLabels();
    $highSensFields = Auth::getHighSensitivityFields();

    $fieldDisplay = array_map(function($field) use ($fieldLabels, $highSensFields) {
        $label = isset($fieldLabels[$field]) ? $fieldLabels[$field] : $field;
        $isHighSens = in_array($field, $highSensFields);
        return [
            'key' => $field,
            'label' => $label,
            'high_sensitivity' => $isHighSens
        ];
    }, $fields);

    $isExpired = strtotime($record['expires_at']) < time();
    $canDownload = $record['status'] === 'approved' && !$isExpired && $record['download_count'] < $record['max_downloads'] && !empty($record['file_path']);

    return [
        'id' => intval($record['id']),
        'export_token' => $record['export_token'],
        'user_name' => $record['user_name'],
        'purpose' => $record['purpose'],
        'fields' => $fieldDisplay,
        'file_format' => $record['file_format'],
        'file_name' => $record['file_name'],
        'total_count' => intval($record['total_count']),
        'download_count' => intval($record['download_count']),
        'max_downloads' => intval($record['max_downloads']),
        'expires_at' => $record['expires_at'],
        'status' => $record['status'],
        'requires_approval' => boolval($record['requires_approval']),
        'is_expired' => $isExpired,
        'can_download' => $canDownload,
        'download_url' => $canDownload ? ('/api/download.php?token=' . $record['export_token']) : null,
        'approval_status' => $record['approval_status'] ?? null,
        'supervisor_name' => $record['supervisor_name'] ?? null,
        'approval_comment' => $record['approval_comment'] ?? null,
        'approved_at' => $record['approved_at'] ?? null,
        'created_at' => $record['created_at']
    ];
}
