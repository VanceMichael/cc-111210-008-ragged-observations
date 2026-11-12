# 海洋文件来源
`/file?kind=contiguous` 和 `kind=indexed` 返回真实CDF-1文件，固定维度profile=2、obs=5。rowSize声明sample_dimension，stationIndex声明instance_dimension；两者表示相同观测关系，profileId、stationId、经纬度与depth提供剖面身份和坐标。`kind=broken` 的计数和观测总量不一致。
时间使用360_day日历。当前查看器能读取维度、变量属性及原始数值切片，尚不装配观测关系或应用科学属性。来源不使用无限维、64位偏移或压缩。温度变量以数值属性声明缺测码、缩放、偏移和有效范围；全局packing字符串只是人类可读说明。
