<?php

class Auth {
    private static $HIGH_SENSITIVITY_FIELDS = ['purchase_price', 'user_name'];
    private static $TOKEN_EXPIRE_HOURS = 24;
    private static $EXPORT_EXPIRE_HOURS = 24;
    private static $MAX_DOWNLOADS = 3;

    public static function getHighSensitivityFields() {
        return self::$HIGH_SENSITIVITY_FIELDS;
    }

    public static function getExportExpireHours() {
        return self::$EXPORT_EXPIRE_HOURS;
    }

    public static function getMaxDownloads() {
        return self::$MAX_DOWNLOADS;
    }

    public static function generateToken() {
        return bin2hex(random_bytes(32));
    }

    public static function getCurrentUser() {
        $headers = array_change_key_case(getallheaders(), CASE_UPPER);
        $token = isset($headers['X-AUTH-TOKEN']) ? $headers['X-AUTH-TOKEN'] : null;

        if (!$token) {
            return null;
        }

        $db = new Database();
        $pdo = $db->connect();

        $stmt = $pdo->prepare("SELECT * FROM users WHERE token = :token AND is_active = 1");
        $stmt->execute(['token' => $token]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        return $user;
    }

    public static function requireLogin() {
        $user = self::getCurrentUser();
        if (!$user) {
            http_response_code(401);
            echo json_encode([
                'success' => false,
                'error' => '请先登录',
                'code' => 'UNAUTHORIZED'
            ]);
            exit;
        }
        return $user;
    }

    public static function requireRole($roles) {
        $user = self::requireLogin();
        if (!is_array($roles)) {
            $roles = [$roles];
        }
        if (!in_array($user['role'], $roles)) {
            http_response_code(403);
            echo json_encode([
                'success' => false,
                'error' => '权限不足',
                'code' => 'FORBIDDEN'
            ]);
            exit;
        }
        return $user;
    }

    public static function checkHighSensitivityFields($fields) {
        $highSensFields = self::$HIGH_SENSITIVITY_FIELDS;
        $selectedHighSens = array_intersect($fields, $highSensFields);
        return !empty($selectedHighSens);
    }

    public static function getHighSensitivityFieldLabels() {
        return [
            'purchase_price' => '采购价格',
            'user_name' => '使用人'
        ];
    }

    public static function getFieldLabels() {
        return [
            'facode' => '固定资产编码',
            'sn' => '序列号',
            'asset_name' => '资产名称',
            'purchase_price' => '采购价格',
            'purchase_date' => '采购日期',
            'user_name' => '使用人',
            'department' => '所属部门',
            'location' => '存放地点',
            'status' => '状态'
        ];
    }

    public static function logAudit($exportRecordId, $userId, $userName, $action, $details = []) {
        try {
            $db = new Database();
            $pdo = $db->connect();

            $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
            $userAgent = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';

            $stmt = $pdo->prepare("
                INSERT INTO export_audit_logs 
                (export_record_id, user_id, user_name, action, ip_address, user_agent, details)
                VALUES 
                (:export_record_id, :user_id, :user_name, :action, :ip_address, :user_agent, :details)
            ");

            $stmt->execute([
                'export_record_id' => $exportRecordId,
                'user_id' => $userId,
                'user_name' => $userName,
                'action' => $action,
                'ip_address' => $ip,
                'user_agent' => substr($userAgent, 0, 500),
                'details' => json_encode($details, JSON_UNESCAPED_UNICODE)
            ]);
        } catch (Exception $e) {
            error_log("Audit log failed: " . $e->getMessage());
        }
    }

    public static function getClientIp() {
        if (!empty($_SERVER['HTTP_CLIENT_IP'])) {
            return $_SERVER['HTTP_CLIENT_IP'];
        } elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            return $_SERVER['HTTP_X_FORWARDED_FOR'];
        } else {
            return $_SERVER['REMOTE_ADDR'];
        }
    }
}
