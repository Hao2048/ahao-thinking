import * as echarts from 'echarts/core';
import {BarChart,LineChart,PieChart,FunnelChart,HeatmapChart,ScatterChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,LegendComponent,DatasetComponent,VisualMapComponent,MarkAreaComponent,MarkLineComponent} from 'echarts/components';
import {SVGRenderer,CanvasRenderer} from 'echarts/renderers';
echarts.use([BarChart,LineChart,PieChart,FunnelChart,HeatmapChart,ScatterChart,GridComponent,TooltipComponent,LegendComponent,DatasetComponent,VisualMapComponent,MarkAreaComponent,MarkLineComponent,SVGRenderer,CanvasRenderer]);
export {echarts};
