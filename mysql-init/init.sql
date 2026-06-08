CREATE DATABASE IF NOT EXISTS fixed_assets;
USE fixed_assets;

-- 资产表（扩展字段）
CREATE TABLE IF NOT EXISTS assets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    facode VARCHAR(50) NOT NULL UNIQUE,
    sn VARCHAR(100) NOT NULL,
    asset_name VARCHAR(200) COMMENT '资产名称',
    purchase_price DECIMAL(12,2) COMMENT '采购价格',
    purchase_date DATE COMMENT '采购日期',
    user_name VARCHAR(100) COMMENT '使用人',
    department VARCHAR(100) COMMENT '所属部门',
    location VARCHAR(200) COMMENT '存放地点',
    status VARCHAR(20) DEFAULT 'normal' COMMENT '状态: normal, scrapped, loaned',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_facode (facode),
    INDEX idx_user (user_name),
    INDEX idx_department (department)
);

-- 插入测试数据
INSERT INTO assets (facode, sn, asset_name, purchase_price, purchase_date, user_name, department, location, status) VALUES 
('FA001', 'SN2024001', 'MacBook Pro 14寸', 14999.00, '2024-01-15', '张三', '研发部', '北京-中关村-A座1001', 'normal'),
('FA002', 'SN2024002', 'Dell 显示器 27寸', 2999.00, '2024-02-20', '李四', '产品部', '北京-中关村-A座1002', 'normal'),
('FA003', 'SN2024003', 'iPhone 15 Pro', 8999.00, '2024-03-10', '王五', '市场部', '上海-陆家嘴-B座2001', 'normal'),
('FA004', 'SN2024004', 'ThinkPad X1 Carbon', 12999.00, '2024-01-20', '赵六', '财务部', '深圳-南山-C座501', 'normal'),
('FA005', 'SN2024005', 'HP LaserJet 打印机', 3599.00, '2023-11-05', '钱七', '行政部', '广州-天河-D座301', 'normal'),
('FA006', 'SN2024006', 'iPad Pro 12.9', 9299.00, '2024-04-01', '孙八', '设计部', '杭州-西湖-E座801', 'normal'),
('FA007', 'SN2024007', 'LG 4K 显示器', 4599.00, '2024-02-15', '周九', '研发部', '北京-中关村-A座1003', 'normal'),
('FA008', 'SN2024008', 'Canon 数码相机', 6899.00, '2023-09-10', '吴十', '市场部', '成都-高新-F座1501', 'scrapped'),
('TEST-01', 'SN-TEST-001', '测试设备-路由器', 599.00, '2024-05-01', '测试员', 'IT运维部', '机房-001', 'normal');

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    real_name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'user' COMMENT 'user: 普通用户, supervisor: 主管, admin: 管理员',
    department VARCHAR(100),
    token VARCHAR(64) COMMENT '登录令牌',
    token_expires_at TIMESTAMP NULL COMMENT '令牌过期时间',
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_role (role),
    INDEX idx_token (token)
);

-- 插入测试用户
INSERT INTO users (username, password, real_name, email, role, department) VALUES 
('zhangsan', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '张三', 'zhangsan@example.com', 'user', '研发部'),
('lisi', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '李四', 'lisi@example.com', 'user', '产品部'),
('wangwu', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '王五', 'wangwu@example.com', 'supervisor', '研发部'),
('admin', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '系统管理员', 'admin@example.com', 'admin', 'IT部');

-- 导出记录表
CREATE TABLE IF NOT EXISTS export_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    export_token VARCHAR(64) NOT NULL UNIQUE COMMENT '下载令牌',
    user_id INT NOT NULL,
    user_name VARCHAR(100) NOT NULL,
    purpose VARCHAR(500) NOT NULL COMMENT '导出用途',
    fields TEXT NOT NULL COMMENT '导出字段，JSON格式',
    filters TEXT COMMENT '筛选条件，JSON格式',
    file_format VARCHAR(10) NOT NULL DEFAULT 'csv' COMMENT '文件格式: csv, excel',
    file_path VARCHAR(500) COMMENT '文件存储路径',
    file_name VARCHAR(200) COMMENT '下载显示文件名',
    total_count INT DEFAULT 0 COMMENT '导出记录总数',
    download_count INT DEFAULT 0 COMMENT '实际下载次数',
    max_downloads INT DEFAULT 3 COMMENT '最大允许下载次数',
    expires_at TIMESTAMP NOT NULL COMMENT '过期时间',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending:待审批, approved:已批准, rejected:已拒绝, expired:已过期',
    approval_id INT COMMENT '关联审批ID',
    requires_approval TINYINT(1) DEFAULT 0 COMMENT '是否需要审批',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_token (export_token),
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    INDEX idx_expires (expires_at)
);

-- 审批表
CREATE TABLE IF NOT EXISTS approvals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    export_record_id INT NOT NULL,
    applicant_id INT NOT NULL,
    applicant_name VARCHAR(100) NOT NULL,
    supervisor_id INT,
    supervisor_name VARCHAR(100),
    high_sensitivity_fields TEXT NOT NULL COMMENT '高敏字段列表，JSON格式',
    purpose VARCHAR(500) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending:待审批, approved:已批准, rejected:已拒绝',
    approval_comment VARCHAR(500) COMMENT '审批意见',
    approved_at TIMESTAMP NULL COMMENT '审批时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_export (export_record_id),
    INDEX idx_applicant (applicant_id),
    INDEX idx_supervisor (supervisor_id),
    INDEX idx_status (status)
);

-- 导出审计日志表
CREATE TABLE IF NOT EXISTS export_audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    export_record_id INT NOT NULL,
    user_id INT NOT NULL,
    user_name VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL COMMENT '操作: create, approve, reject, download, expire',
    ip_address VARCHAR(50),
    user_agent VARCHAR(500),
    details TEXT COMMENT '详情，JSON格式',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_export (export_record_id),
    INDEX idx_user (user_id),
    INDEX idx_action (action)
);

-- 创建 api 用户 (适配用户测试场景)
CREATE USER IF NOT EXISTS 'api'@'%' IDENTIFIED BY 'FJzzCT#api';
GRANT SELECT, INSERT, UPDATE ON fixed_assets.* TO 'api'@'%';
FLUSH PRIVILEGES;
