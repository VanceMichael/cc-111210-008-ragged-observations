# 海洋文件来源
`/file?kind=contiguous` 和 `kind=indexed` 返回真实CDF-1文件，固定维度station=2、obs=5。rowSize声明sample_dimension，stationIndex声明instance_dimension；两者表示相同观测关系。`kind=broken` 的计数和观测总量不一致。
时间使用360_day日历。当前查看器能查看文件维度，完整变量读取需按CDF-1中变量类型、维度、vsize及begin实现；来源不使用无限维、64位偏移或压缩。全局packing字符串用于现场说明；实际采集时应把这些属性读取为变量的数值属性。
