# 海洋文件来源
`/file?kind=contiguous` 和 `kind=indexed` 返回真实CDF-1文件，固定维度profile=2、obs=5。rowSize声明sample_dimension，stationIndex声明instance_dimension；两者表示相同观测关系，profileId、stationId、经纬度与depth提供剖面身份和坐标。`kind=broken` 的计数和观测总量不一致；`kind=sparse` 的首个剖面是合法的零次观测剖面（rowSize=[0,5]）；`kind=indexed-broken` 的末元素索引越界（stationIndex含7，超出profile维）。
时间使用360_day日历，包含第59、60、359和360日，不能按公历闰年规则转成日期。查看器读取维度、变量属性及原始数值切片；采集器按CF约定装配观测关系并应用科学属性。来源不使用无限维、64位偏移或压缩。温度变量以数值属性声明缺测码、缩放、偏移和有效范围；全局packing字符串只是人类可读说明。

## 采集语义
- 按变量上的`sample_dimension`（连续计数）或`instance_dimension`（索引指回）识别ragged表示，两种表示的等价观测采成同一业务结构。
- 观测值先判`_FillValue`/`missing_value`与`valid_range`再应用`scale_factor`/`add_offset`，缺测码不缩成正常值；越界但未填充的值置空并记入记录的invalid列表。
- 时间由units与calendar共同决定：公历族日历给出ISO瞬间；360_day等日历只在其自身历法内分解日期（如第59日为2000-02-30），无法表达的保留原日历与数值，不硬转公历。
- 每个变量按chunkSize切片受控读取，读取痕迹写入reads；每条记录的provenance给出字段来源的变量路径（CDF-1无组，变量名即路径）与元素索引。
- 零次观测剖面合法；越界索引仅隔离对应观测元素，计数不守恒则整体不发布观测，两类问题都写入带变量与元素索引的errors，不悄悄错位后继续发布。
