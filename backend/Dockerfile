FROM php:8.2-apache

# 启用 Rewrite 模块
RUN a2enmod rewrite

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    libonig-dev \
    && rm -rf /var/lib/apt/lists/*

# 安装 PDO MySQL 扩展和 mbstring 扩展
RUN docker-php-ext-install pdo pdo_mysql mbstring

# 设置工作目录
WORKDIR /var/www/html

# 创建导出目录并设置权限
RUN mkdir -p /var/www/html/exports \
    && chown -R www-data:www-data /var/www/html/exports \
    && chmod -R 775 /var/www/html/exports

# 复制源代码
COPY . /var/www/html/

# 设置权限，确保 Apache 用户可以写入 (关键步骤)
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html \
    && chmod -R 775 /var/www/html/exports

# 暴露端口
EXPOSE 80
