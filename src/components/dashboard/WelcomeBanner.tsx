import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { useThemeStore } from "@/stores/useThemeStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { useStudyTimeTracker } from "@/hooks/useStudyTimeTracker";

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    if (data.name === "(day)") return null;

    const mins = data.rawMinutes || 0;

    let timeText = "";
    if (mins < 60) {
      timeText = `${mins} phút`;
    } else {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      timeText = m > 0 ? `${h} tiếng ${m} phút` : `${h} tiếng`;
    }

    return (
      <div className="relative bg-[#45FFCA] text-[#0a1628] px-3 py-2 rounded-[8px] shadow-lg text-center min-w-[110px] -mt-12 flex flex-col items-center justify-center">
        <span className="text-[13px] font-normal leading-[18px]">Bạn đã học</span>
        <span className="text-[15px] font-bold leading-[20px]">{timeText}</span>
        {/* Arrow pointer down */}
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#45FFCA] rotate-45 rounded-[1px]"></div>
      </div>
    );
  }
  return null;
};

interface WelcomeBannerProps {
  actionRight?: React.ReactNode;
}

export function WelcomeBanner({ actionRight }: WelcomeBannerProps) {
  const { colorStyle } = useThemeStore();
  const userName = useAuthStore((s) => s.user?.name || "Learner");
  const { chartData, todayMinutes, weeklyAvgMinutes, comparisonPercent } = useStudyTimeTracker();

  // Format minutes thành text dễ đọc
  const formatTime = (mins: number) => {
    if (mins < 60) return `${mins} phút`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h} tiếng ${m} phút` : `${h} tiếng`;
  };

  // Dynamic message dựa trên so sánh hôm nay vs trung bình tuần
  const renderMomentumMessage = () => {
    if (todayMinutes === 0) {
      return (
        <p className="text-[13px] font-normal leading-[18px] text-white/90 max-w-[90%]">
          Hôm nay bạn chưa bắt đầu học.<br />
          Hãy dành chút thời gian để duy trì nhịp độ tuần này nhé!
        </p>
      );
    }

    if (weeklyAvgMinutes === 0) {
      return (
        <p className="text-[13px] font-normal leading-[18px] text-white/90 max-w-[90%]">
          Bạn đã học <span className="text-[#45FFCA] font-semibold">{formatTime(todayMinutes)}</span> hôm nay.<br />
          Khởi đầu tuần mới thật tuyệt vời!
        </p>
      );
    }

    if (comparisonPercent >= 100) {
      const overPercent = comparisonPercent - 100;
      return (
        <p className="text-[13px] font-normal leading-[18px] text-white/90 max-w-[90%]">
          Hôm nay bạn đã học <span className="text-[#45FFCA] font-semibold">{formatTime(todayMinutes)}</span>,{' '}
          {overPercent > 0 ? (
            <>cao hơn <span className="text-[#45FFCA] font-semibold">{overPercent}%</span> so với</>
          ) : (
            <>bằng với</>
          )}{' '}
          trung bình tuần ({formatTime(weeklyAvgMinutes)}/ngày).<br />
          Giữ vững nhịp độ này nhé!
        </p>
      );
    }

    return (
      <p className="text-[13px] font-normal leading-[18px] text-white/90 max-w-[90%]">
        Hôm nay bạn đã học <span className="text-[#45FFCA] font-semibold">{formatTime(todayMinutes)}</span>.<br />
        Trung bình tuần của bạn là {formatTime(weeklyAvgMinutes)}/ngày — cố thêm một chút nữa nhé!
      </p>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="w-full"
    >
      <div className="flex justify-between items-start w-full">
        <div>
          {/* Welcome Badge */}
          <div
            className="mb-3 inline-flex w-fit whitespace-nowrap items-center justify-center h-[23px] rounded-[41px] px-3 py-1 text-[10px] font-bold uppercase tracking-widest font-['SF_Pro',_sans-serif]"
            style={{ backgroundColor: "#43FDD7", color: "#000" }}
          >
            Welcome back, {userName.split(" ")[0]}
          </div>

          {/* Main Heading */}
          <h1 className="mb-6 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Hành trình học tập của tôi
          </h1>
        </div>

        {actionRight && (
          <div className="shrink-0 ml-4">
            {actionRight}
          </div>
        )}
      </div>

      {/* Weekly Momentum Card */}
      <div
        className={cn(
          "relative flex flex-col overflow-hidden rounded-[32px] pt-6 shadow-sm text-primary-foreground w-full max-w-[840px] h-[300px]",
          colorStyle === "gradient"
            ? "bg-gradient-to-r from-primary to-primary/80"
            : "bg-primary"
        )}
      >
        <div className="relative z-10 w-full px-8 md:px-10 mb-1">
          <h3 className="mb-2 text-[22px] font-bold tracking-tight text-white">Weekly Momentum</h3>
          {renderMomentumMessage()}
        </div>

        <div className="relative w-full flex-1 mt-auto">
          <div className="absolute top-[0px] left-[18px] text-[12px] text-white/90 z-10">(m)</div>
          <div className="absolute inset-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={[...chartData, { name: "(day)", rawMinutes: chartData[chartData.length - 1]?.rawMinutes ? chartData[chartData.length - 1].rawMinutes * 1.1 : 0 }]}
                margin={{ top: 35, right: 30, left: -5, bottom: 20 }}
              >
                <defs>
                  <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#45FFCA" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#45FFCA" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="4 4"
                  vertical={true}
                  horizontal={false}
                  stroke="rgba(255,255,255,0.2)"
                />
                <XAxis
                  dataKey="name"
                  axisLine={{ stroke: 'rgba(255,255,255,0.4)', strokeWidth: 1 }}
                  tickLine={{ stroke: 'rgba(255,255,255,0.4)', strokeWidth: 1 }}
                  tick={{ fill: 'rgba(255,255,255,0.85)', fontSize: 12 }}
                  tickMargin={12}
                />
                <YAxis
                  axisLine={{ stroke: 'rgba(255,255,255,0.4)', strokeWidth: 1 }}
                  tickLine={{ stroke: 'rgba(255,255,255,0.4)', strokeWidth: 1 }}
                  tick={{ fill: 'rgba(255,255,255,0.85)', fontSize: 12 }}
                  allowDecimals={false}
                  tickFormatter={(val) => val === 0 ? '' : val}
                  tickCount={5}
                  domain={[0, 'auto']}
                  width={40}
                />
                <RechartsTooltip
                  content={<CustomTooltip />}
                  cursor={{ stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1, strokeDasharray: '4 4' }}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="rawMinutes"
                  stroke="#45FFCA"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorHours)"
                  activeDot={{ r: 5, fill: '#45FFCA', stroke: '#fff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
