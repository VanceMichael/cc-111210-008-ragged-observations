# 海洋剖面文件的观测点采集

本项目用于授权资料接入的单次查看与接收留存，使用 Node.js 22。来源协议见 `docs/source-contract.md`。本地演练服务只绑定回环地址，数据不含真实个人资料或账号。

## 安装与运行

依赖由 `package-lock.json` 固定。首次准备环境运行 `npm ci --ignore-scripts`，浏览器项目使用 Playwright 1.56.1 对应的 Chromium；浏览器及系统库在镜像准备阶段安装，不在业务命令中下载。

```sh
npm run build
npm test
npm run demo
npm start
```

`npm run demo` 启动本地来源和接入服务，实际采集连续与索引两种表示的逐观测记录并比对一致性，展示损坏关系的隔离结果，写入临时接收记录，显示完整 JSON，随后关闭服务并清理临时目录。通常在十秒内结束。`npm start` 启动常驻服务，默认端口3000，可通过 PORT 与 DATA_DIR 修改监听端口和接收目录。设置 SOURCE_URL 可连接另一进程中已启动的本地来源；不设置时自动创建演练来源。恢复演练可先用 `npm run source` 在另一终端启动来源，记下输出地址，保持该进程运行，仅重启设置了 SOURCE_URL 的接入服务。

## 接口与模块

`GET /health` 查看状态，`GET /inspect` 查看来源原始结构，`GET /collect?kind=contiguous&chunkSize=1000` 采集逐观测记录，`GET /receive?key=sample&kind=contiguous` 保存单次采集结果，`GET /receipts/sample` 读取回执。相同key和相同内容可重复接收，不同内容拒绝覆盖。

`src/connector.mjs` 解释单次来源响应，`src/observations.mjs` 按CF约定把连续计数与索引两种ragged表示装配成逐观测记录：先判填充值和有效范围再缩放，360_day时间保留原日历与数值，按变量切片受控读取并记录来源，越界索引与计数不守恒隔离为可定位错误。`fixtures/source.mjs` 提供可重复启动的本地来源，`src/service.mjs` 组织访问入口，`src/store.mjs` 保存查看结果。`test/connector.test.mjs` 验证协议原语和演练源，`test/observations.test.mjs` 验证采集装配与错误隔离，`test/service.test.mjs` 验证服务与留存边界。

生产接入地址与凭据需由部署配置给出；演练客户端拒绝访问回环以外的地址。文档中的接口不向外提供任意目标代理。异常以明确错误响应返回，接收失败不覆盖原回执。
