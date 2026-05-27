use napi_derive::napi;
use serde::Serialize;

const SR_ZONE_PIVOT_PERIOD: usize = 9;
const SR_ZONE_MIN_STRENGTH: usize = 2;
const SR_ZONE_MAX_PIVOTS: usize = 15;
const SR_ZONE_CHANNEL_WIDTH_PCT: f64 = 8.0;
const SR_ZONE_MAX_LEVELS: usize = 6;
const VOLUME_STRUCTURE_CALC_BARS: usize = 180;
const VOLUME_STRUCTURE_ROW_COUNT: usize = 20;
const LIQUIDITY_ZONE_LOOKBACK: usize = 15;
const LIQUIDITY_ZONE_MAX_AGE: usize = 120;
const LIQUIDITY_TAIL_ATR_LENGTH: usize = 14;
const LIQUIDITY_TAIL_ATR_MULT: f64 = 0.8;
const LIQUIDITY_TAIL_MIN_WICK_RATIO: f64 = 1.3;
const LIQUIDITY_TAIL_WICK_DOMINANCE: f64 = 1.2;
const LIQUIDITY_TAIL_MIN_GAP: usize = 5;
const LIQUIDITY_TAIL_MAX_AGE: usize = 120;
const TREND_FOLLOW_PIVOT_LENGTH: usize = 10;
const TREND_FOLLOW_ATR_LENGTH: usize = 14;
const TREND_FOLLOW_ATR_MULT: f64 = 4.0;
const ADAPTIVE_CHANNEL_REGRESSION_BARS: usize = 7;
const ADAPTIVE_CHANNEL_ENVELOPE_BARS: usize = 2;
const ADAPTIVE_CHANNEL_ATR_STRETCH: f64 = 2.0;
const ADAPTIVE_CHANNEL_VOLATILITY_LOOKBACK: usize = 100;
const ADAPTIVE_CHANNEL_CALC_LOOKBACK: usize = 220;

#[napi(object)]
#[derive(Clone)]
pub struct NativeCandle {
    pub timestamp: f64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub turnover: Option<f64>,
    #[napi(js_name = "takerBuyBaseVolume")]
    pub taker_buy_base_volume: Option<f64>,
    #[napi(js_name = "takerSellBaseVolume")]
    pub taker_sell_base_volume: Option<f64>,
}

#[derive(Clone)]
struct LiquidityZoneSnapshot {
    kind: &'static str,
    top: f64,
    bottom: f64,
    level: f64,
    start_index: usize,
    hit_count: usize,
    crossed: bool,
}

#[derive(Clone)]
struct LiquidityTailZoneSnapshot {
    kind: &'static str,
    top: f64,
    bottom: f64,
    mid: f64,
    start_index: usize,
    touches: usize,
    spent: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeOverlay {
    volume_structure: VolumeStructureContext,
    sr_zones: SrZonesContext,
    liquidity_zones: LiquidityZonesContext,
    liquidity_tails: LiquidityTailsContext,
    trend_follow: TrendFollowContext,
    adaptive_channel: AdaptiveChannelContext,
    delta: DeltaContext,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VolumeStructureContext {
    point_of_control: Option<f64>,
    poc_index: Option<usize>,
    point_of_control_volume_share: Option<f64>,
    poc_up_volume_share: Option<f64>,
    poc_down_volume_share: Option<f64>,
    total_up_volume_share: Option<f64>,
    total_down_volume_share: Option<f64>,
    price_above_point_of_control: Option<bool>,
    distance_to_point_of_control_atr: Option<f64>,
    row_count: usize,
    calc_bars: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SrZoneLevel {
    level: f64,
    upper: f64,
    lower: f64,
    strength: usize,
    distance_pct: Option<f64>,
    side: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SrDistance {
    level: Option<f64>,
    strength: Option<usize>,
    distance_atr: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SrZonesContext {
    levels: Vec<SrZoneLevel>,
    nearest_support: SrDistance,
    nearest_resistance: SrDistance,
    crossed_above: Option<bool>,
    crossed_below: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LiquidityZoneItem {
    top: Option<f64>,
    bottom: Option<f64>,
    level: Option<f64>,
    age_bars: Option<usize>,
    hit_count: Option<usize>,
    distance_atr: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LiquidityZonesContext {
    active_count: usize,
    nearest_support: LiquidityZoneItem,
    nearest_resistance: LiquidityZoneItem,
    active_retest_direction: Option<&'static str>,
    retest_penetration_pct: Option<f64>,
    crossed_above: Option<bool>,
    crossed_below: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LiquidityTailItem {
    top: Option<f64>,
    bottom: Option<f64>,
    mid: Option<f64>,
    touches: Option<usize>,
    age_bars: Option<usize>,
    distance_atr: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrentTail {
    side: Option<&'static str>,
    wick_atr: Option<f64>,
    wick_body_ratio: Option<f64>,
    dominance: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LiquidityTailsContext {
    active_count: usize,
    nearest_buy_pressure: LiquidityTailItem,
    nearest_sell_pressure: LiquidityTailItem,
    current_tail: CurrentTail,
    active_retest_direction: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrendFollowContext {
    state: &'static str,
    last_signal_direction: Option<&'static str>,
    signal_age_bars: Option<usize>,
    trail_stop: Option<f64>,
    distance_to_trail_stop_atr: Option<f64>,
    distance_to_trail_stop_pct: Option<f64>,
    last_pivot_high: Option<f64>,
    last_pivot_low: Option<f64>,
    breakout_confirmed: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdaptiveChannelContext {
    centerline: Option<f64>,
    upper: Option<f64>,
    lower: Option<f64>,
    direction: &'static str,
    regime: &'static str,
    roof: Option<f64>,
    floor: Option<f64>,
    flip_up: Option<bool>,
    flip_down: Option<bool>,
    half_channel_atr: Option<f64>,
    centerline_slope: Option<f64>,
    channel_width_atr: Option<f64>,
    price_position_in_channel: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaContext {
    source: &'static str,
    buy_pressure_pct: Option<f64>,
    buy_volume: Option<f64>,
    sell_volume: Option<f64>,
    net_delta: Option<f64>,
    delta_pct: Option<f64>,
    signed_volume: Option<f64>,
    signed_volume_z_score: Option<f64>,
    delta_slope: Option<f64>,
    delta_divergence_vs_price: &'static str,
}

fn finite(value: f64) -> Option<f64> {
    if value.is_finite() {
        Some(value)
    } else {
        None
    }
}

fn safe_divide(num: Option<f64>, den: Option<f64>) -> Option<f64> {
    let num = num?;
    let den = den?;
    if !num.is_finite() || !den.is_finite() || den == 0.0 {
        None
    } else {
        Some(num / den)
    }
}

fn calculate_range_position(price: f64, low: f64, high: f64) -> Option<f64> {
    if high <= low {
        None
    } else {
        Some((price - low) / (high - low))
    }
}

fn calculate_line_slope(values: &[f64], period: usize) -> Option<f64> {
    if values.len() < period || period < 2 {
        return None;
    }
    let slice = &values[values.len() - period..];
    let x_mean = (period - 1) as f64 / 2.0;
    let y_mean = slice.iter().sum::<f64>() / period as f64;
    let mut numerator = 0.0;
    let mut denominator = 0.0;
    for (index, value) in slice.iter().enumerate() {
        let x = index as f64;
        numerator += (x - x_mean) * (value - y_mean);
        denominator += (x - x_mean).powi(2);
    }
    if denominator == 0.0 {
        None
    } else {
        Some(numerator / denominator)
    }
}

fn calculate_z_score(values: &[f64], value: Option<f64>) -> Option<f64> {
    let value = value?;
    let finite_values: Vec<f64> = values.iter().copied().filter(|v| v.is_finite()).collect();
    if finite_values.len() < 2 {
        return None;
    }
    let mean = finite_values.iter().sum::<f64>() / finite_values.len() as f64;
    let variance = finite_values
        .iter()
        .map(|item| (item - mean).powi(2))
        .sum::<f64>()
        / finite_values.len() as f64;
    let sd = variance.sqrt();
    if sd == 0.0 {
        None
    } else {
        Some((value - mean) / sd)
    }
}

fn true_range(candles: &[NativeCandle], index: usize) -> f64 {
    let candle = &candles[index];
    if index == 0 {
        candle.high - candle.low
    } else {
        let prev_close = candles[index - 1].close;
        (candle.high - candle.low)
            .max((candle.high - prev_close).abs())
            .max((candle.low - prev_close).abs())
    }
}

fn calculate_atr_series(candles: &[NativeCandle], period: usize) -> Vec<Option<f64>> {
    let mut result = vec![None; candles.len()];
    if candles.len() < period || period == 0 {
        return result;
    }

    let mut sum = 0.0;
    for index in 0..candles.len() {
        sum += true_range(candles, index);
        if index >= period {
            sum -= true_range(candles, index - period);
        }
        if index + 1 >= period {
            result[index] = Some(sum / period as f64);
        }
    }
    result
}

fn calculate_atr_at(candles: &[NativeCandle], index: usize, period: usize) -> Option<f64> {
    if candles.is_empty() || period == 0 {
        return None;
    }
    let start = index.saturating_add(1).saturating_sub(period);
    let mut sum = 0.0;
    let mut count = 0usize;
    for cursor in start..=index.min(candles.len() - 1) {
        sum += true_range(candles, cursor);
        count += 1;
    }
    if count == 0 {
        None
    } else {
        Some(sum / count as f64)
    }
}

fn is_confirmed_pivot_high(candles: &[NativeCandle], index: usize, lookback: usize) -> bool {
    let Some(candidate) = candles.get(index) else {
        return false;
    };
    let start = index.saturating_sub(lookback);
    let end = (index + lookback).min(candles.len().saturating_sub(1));
    for cursor in start..=end {
        if cursor != index && candles[cursor].high > candidate.high {
            return false;
        }
    }
    true
}

fn is_confirmed_pivot_low(candles: &[NativeCandle], index: usize, lookback: usize) -> bool {
    let Some(candidate) = candles.get(index) else {
        return false;
    };
    let start = index.saturating_sub(lookback);
    let end = (index + lookback).min(candles.len().saturating_sub(1));
    for cursor in start..=end {
        if cursor != index && candles[cursor].low < candidate.low {
            return false;
        }
    }
    true
}

fn overlap_height(band_low: f64, band_high: f64, area_low: f64, area_high: f64) -> f64 {
    (band_high.min(area_high) - band_low.max(area_low)).max(0.0)
}

fn clamp_index(value: isize, max_index: usize) -> usize {
    value.max(0).min(max_index as isize) as usize
}

fn build_volume_structure_context(
    candles: &[NativeCandle],
    price: f64,
    atr: Option<f64>,
) -> VolumeStructureContext {
    let start_index = candles.len().saturating_sub(VOLUME_STRUCTURE_CALC_BARS);
    let calc_bars = candles.len() - start_index;
    let empty = || VolumeStructureContext {
        point_of_control: None,
        poc_index: None,
        point_of_control_volume_share: None,
        poc_up_volume_share: None,
        poc_down_volume_share: None,
        total_up_volume_share: None,
        total_down_volume_share: None,
        price_above_point_of_control: None,
        distance_to_point_of_control_atr: None,
        row_count: VOLUME_STRUCTURE_ROW_COUNT,
        calc_bars,
    };

    if calc_bars == 0 {
        return empty();
    }

    let mut top = f64::NEG_INFINITY;
    let mut bottom = f64::INFINITY;
    for candle in &candles[start_index..] {
        top = top.max(candle.high);
        bottom = bottom.min(candle.low);
    }

    let range = top - bottom;
    if range <= 0.0 {
        return VolumeStructureContext {
            point_of_control: Some(price),
            poc_index: Some(0),
            point_of_control_volume_share: Some(1.0),
            poc_up_volume_share: None,
            poc_down_volume_share: None,
            total_up_volume_share: None,
            total_down_volume_share: None,
            price_above_point_of_control: Some(false),
            distance_to_point_of_control_atr: safe_divide(Some(0.0), atr),
            row_count: VOLUME_STRUCTURE_ROW_COUNT,
            calc_bars,
        };
    }

    let row_count = VOLUME_STRUCTURE_ROW_COUNT;
    let step = range / row_count as f64;
    let mut up_volumes = vec![0.0; row_count];
    let mut down_volumes = vec![0.0; row_count];

    for candle in &candles[start_index..] {
        let body_top = candle.close.max(candle.open);
        let body_bottom = candle.close.min(candle.open);
        let body = body_top - body_bottom;
        let top_wick = candle.high - body_top;
        let bottom_wick = body_bottom - candle.low;
        let weighted_range = 2.0 * top_wick + 2.0 * bottom_wick + body;
        if weighted_range <= 0.0 {
            continue;
        }

        let body_volume = (body * candle.volume) / weighted_range;
        let top_wick_volume = (2.0 * top_wick * candle.volume) / weighted_range;
        let bottom_wick_volume = (2.0 * bottom_wick * candle.volume) / weighted_range;
        let is_up_bar = candle.close >= candle.open;
        let mut distribute = |segment_low: f64,
                              segment_high: f64,
                              segment_volume: f64,
                              up_share: f64,
                              down_share: f64| {
            let segment_height = segment_high - segment_low;
            if segment_height <= 0.0 || segment_volume <= 0.0 {
                return;
            }
            let start = clamp_index(
                ((segment_low - bottom) / step).floor() as isize,
                row_count - 1,
            );
            let end = clamp_index(
                ((segment_high - bottom) / step).floor() as isize,
                row_count - 1,
            );
            for index in start..=end {
                let band_low = bottom + step * index as f64;
                let band_high = band_low + step;
                let allocated_volume =
                    (overlap_height(band_low, band_high, segment_low, segment_high)
                        / segment_height)
                        * segment_volume;
                up_volumes[index] += allocated_volume * up_share;
                down_volumes[index] += allocated_volume * down_share;
            }
        };

        distribute(
            body_bottom,
            body_top,
            body_volume,
            if is_up_bar { 1.0 } else { 0.0 },
            if is_up_bar { 0.0 } else { 1.0 },
        );
        distribute(body_top, candle.high, top_wick_volume, 0.5, 0.5);
        distribute(candle.low, body_bottom, bottom_wick_volume, 0.5, 0.5);
    }

    let mut total_volume = 0.0;
    let mut max_volume = f64::NEG_INFINITY;
    let mut poc_index = 0usize;
    let mut total_up_volume = 0.0;
    let mut total_down_volume = 0.0;
    for index in 0..row_count {
        let up_volume = up_volumes[index];
        let down_volume = down_volumes[index];
        let total_row_volume = up_volume + down_volume;
        total_volume += total_row_volume;
        total_up_volume += up_volume;
        total_down_volume += down_volume;
        if total_row_volume > max_volume {
            max_volume = total_row_volume;
            poc_index = index;
        }
    }

    let point_of_control = bottom + step * (poc_index as f64 + 0.5);
    let poc_total_volume = up_volumes[poc_index] + down_volumes[poc_index];
    VolumeStructureContext {
        point_of_control: Some(point_of_control),
        poc_index: Some(poc_index),
        point_of_control_volume_share: safe_divide(Some(max_volume), Some(total_volume)),
        poc_up_volume_share: safe_divide(Some(up_volumes[poc_index]), Some(poc_total_volume)),
        poc_down_volume_share: safe_divide(Some(down_volumes[poc_index]), Some(poc_total_volume)),
        total_up_volume_share: safe_divide(Some(total_up_volume), Some(total_volume)),
        total_down_volume_share: safe_divide(Some(total_down_volume), Some(total_volume)),
        price_above_point_of_control: Some(price > point_of_control),
        distance_to_point_of_control_atr: safe_divide(Some(price - point_of_control), atr),
        row_count,
        calc_bars,
    }
}

fn build_sr_zones_context(
    candles: &[NativeCandle],
    price: f64,
    previous_price: Option<f64>,
    atr: Option<f64>,
) -> SrZonesContext {
    let empty = || SrZonesContext {
        levels: Vec::new(),
        nearest_support: SrDistance {
            level: None,
            strength: None,
            distance_atr: None,
        },
        nearest_resistance: SrDistance {
            level: None,
            strength: None,
            distance_atr: None,
        },
        crossed_above: None,
        crossed_below: None,
    };

    if candles.len() < SR_ZONE_PIVOT_PERIOD * 2 + 1 {
        return empty();
    }

    let mut pivot_values: Vec<f64> = Vec::new();
    for index in SR_ZONE_PIVOT_PERIOD..(candles.len() - SR_ZONE_PIVOT_PERIOD) {
        let candle = &candles[index];
        let mut is_pivot_high = true;
        let mut is_pivot_low = true;
        for cursor in (index - SR_ZONE_PIVOT_PERIOD)..index {
            is_pivot_high &= candle.high >= candles[cursor].high;
            is_pivot_low &= candle.low <= candles[cursor].low;
        }
        for cursor in (index + 1)..=(index + SR_ZONE_PIVOT_PERIOD) {
            is_pivot_high &= candle.high >= candles[cursor].high;
            is_pivot_low &= candle.low <= candles[cursor].low;
        }
        if is_pivot_high || is_pivot_low {
            pivot_values.insert(
                0,
                if is_pivot_high {
                    candle.high
                } else {
                    candle.low
                },
            );
            if pivot_values.len() > SR_ZONE_MAX_PIVOTS {
                pivot_values.pop();
            }
        }
    }

    if pivot_values.is_empty() {
        return empty();
    }

    let highest = candles
        .iter()
        .fold(f64::NEG_INFINITY, |acc, candle| acc.max(candle.high));
    let lowest = candles
        .iter()
        .fold(f64::INFINITY, |acc, candle| acc.min(candle.low));
    let channel_width = ((highest - lowest) * SR_ZONE_CHANNEL_WIDTH_PCT) / 100.0;
    let mut sr_levels: Vec<(f64, f64, usize)> = Vec::new();

    for pivot_value in &pivot_values {
        let mut lower = *pivot_value;
        let mut upper = *pivot_value;
        let mut strength = 0usize;
        for candidate in &pivot_values {
            let width = if *candidate <= lower {
                upper - candidate
            } else {
                candidate - lower
            };
            if width <= channel_width {
                lower = lower.min(*candidate);
                upper = upper.max(*candidate);
                strength += 1;
            }
        }

        let overlap_index = sr_levels.iter().position(|(up, lo, _)| {
            (*up >= lower && *up <= upper) || (*lo >= lower && *lo <= upper)
        });
        if let Some(index) = overlap_index {
            if strength >= sr_levels[index].2 {
                sr_levels.remove(index);
            } else {
                continue;
            }
        }

        if strength >= SR_ZONE_MIN_STRENGTH {
            sr_levels.push((upper, lower, strength));
            sr_levels.sort_by(|left, right| right.2.cmp(&left.2));
            sr_levels.truncate(SR_ZONE_MAX_LEVELS);
        }
    }

    let levels: Vec<SrZoneLevel> = sr_levels
        .iter()
        .map(|(upper, lower, strength)| {
            let mid = (upper + lower) / 2.0;
            SrZoneLevel {
                level: mid,
                upper: *upper,
                lower: *lower,
                strength: *strength,
                distance_pct: if price == 0.0 {
                    None
                } else {
                    Some(((mid - price) / price) * 100.0)
                },
                side: if mid >= price {
                    "resistance"
                } else {
                    "support"
                },
            }
        })
        .collect();

    let nearest_support = levels
        .iter()
        .filter(|level| level.level <= price)
        .min_by(|left, right| {
            (price - left.level)
                .abs()
                .partial_cmp(&(price - right.level).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned();
    let nearest_resistance = levels
        .iter()
        .filter(|level| level.level >= price)
        .min_by(|left, right| {
            (left.level - price)
                .abs()
                .partial_cmp(&(right.level - price).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned();

    let crossed_above = previous_price.map(|previous| {
        levels
            .iter()
            .any(|level| previous <= level.level && price > level.level)
    });
    let crossed_below = previous_price.map(|previous| {
        levels
            .iter()
            .any(|level| previous >= level.level && price < level.level)
    });

    SrZonesContext {
        levels,
        nearest_support: SrDistance {
            level: nearest_support.as_ref().map(|level| level.level),
            strength: nearest_support.as_ref().map(|level| level.strength),
            distance_atr: safe_divide(
                nearest_support.as_ref().map(|level| price - level.level),
                atr,
            ),
        },
        nearest_resistance: SrDistance {
            level: nearest_resistance.as_ref().map(|level| level.level),
            strength: nearest_resistance.as_ref().map(|level| level.strength),
            distance_atr: safe_divide(
                nearest_resistance.as_ref().map(|level| level.level - price),
                atr,
            ),
        },
        crossed_above,
        crossed_below,
    }
}

fn empty_liquidity_zone_item() -> LiquidityZoneItem {
    LiquidityZoneItem {
        top: None,
        bottom: None,
        level: None,
        age_bars: None,
        hit_count: None,
        distance_atr: None,
    }
}

fn build_liquidity_zones_context(
    candles: &[NativeCandle],
    price: f64,
    previous_price: Option<f64>,
    atr: Option<f64>,
) -> LiquidityZonesContext {
    let empty = || LiquidityZonesContext {
        active_count: 0,
        nearest_support: empty_liquidity_zone_item(),
        nearest_resistance: empty_liquidity_zone_item(),
        active_retest_direction: None,
        retest_penetration_pct: None,
        crossed_above: None,
        crossed_below: None,
    };
    if candles.len() < LIQUIDITY_ZONE_LOOKBACK * 2 + 1 {
        return empty();
    }

    let mut zones: Vec<LiquidityZoneSnapshot> = Vec::new();
    for index in LIQUIDITY_ZONE_LOOKBACK..(candles.len() - LIQUIDITY_ZONE_LOOKBACK) {
        let candle = &candles[index];
        for zone in zones.iter_mut() {
            if !zone.crossed && candle.low < zone.top && candle.high > zone.bottom {
                zone.hit_count += 1;
            }
        }
        if is_confirmed_pivot_high(candles, index, LIQUIDITY_ZONE_LOOKBACK) {
            let top = candle.high;
            let bottom = candle.open.max(candle.close);
            zones.push(LiquidityZoneSnapshot {
                kind: "swing_high_liquidity",
                top,
                bottom,
                level: top,
                start_index: index,
                hit_count: 0,
                crossed: false,
            });
        }
        if is_confirmed_pivot_low(candles, index, LIQUIDITY_ZONE_LOOKBACK) {
            let top = candle.open.min(candle.close);
            let bottom = candle.low;
            zones.push(LiquidityZoneSnapshot {
                kind: "swing_low_liquidity",
                top,
                bottom,
                level: bottom,
                start_index: index,
                hit_count: 0,
                crossed: false,
            });
        }
    }

    let last_index = candles.len() - 1;
    let current = &candles[last_index];
    let active_zones: Vec<LiquidityZoneSnapshot> = zones
        .into_iter()
        .filter_map(|mut zone| {
            if last_index - zone.start_index > LIQUIDITY_ZONE_MAX_AGE {
                return None;
            }
            let crossed = zone.crossed
                || if zone.kind == "swing_high_liquidity" {
                    current.close > zone.top
                } else {
                    current.close < zone.bottom
                };
            zone.crossed = crossed;
            if crossed {
                None
            } else {
                Some(zone)
            }
        })
        .collect();

    let nearest_support = active_zones
        .iter()
        .filter(|zone| zone.kind == "swing_low_liquidity")
        .min_by(|left, right| {
            (price - left.level)
                .abs()
                .partial_cmp(&(price - right.level).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned();
    let nearest_resistance = active_zones
        .iter()
        .filter(|zone| zone.kind == "swing_high_liquidity")
        .min_by(|left, right| {
            (left.level - price)
                .abs()
                .partial_cmp(&(right.level - price).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned();

    let support_retest = nearest_support
        .as_ref()
        .map(|zone| current.low <= zone.top)
        .unwrap_or(false);
    let resistance_retest = nearest_resistance
        .as_ref()
        .map(|zone| current.high >= zone.bottom)
        .unwrap_or(false);
    let retest_zone = if support_retest {
        nearest_support.as_ref()
    } else if resistance_retest {
        nearest_resistance.as_ref()
    } else {
        None
    };
    let retest_penetration = retest_zone.map(|zone| {
        if zone.kind == "swing_low_liquidity" {
            (zone.top - current.low).max(0.0)
        } else {
            (current.high - zone.bottom).max(0.0)
        }
    });
    let retest_height = retest_zone.map(|zone| (zone.top - zone.bottom).max(0.0));

    LiquidityZonesContext {
        active_count: active_zones.len(),
        nearest_support: LiquidityZoneItem {
            top: nearest_support.as_ref().map(|zone| zone.top),
            bottom: nearest_support.as_ref().map(|zone| zone.bottom),
            level: nearest_support.as_ref().map(|zone| zone.level),
            age_bars: nearest_support
                .as_ref()
                .map(|zone| last_index - zone.start_index),
            hit_count: nearest_support.as_ref().map(|zone| zone.hit_count),
            distance_atr: safe_divide(nearest_support.as_ref().map(|zone| price - zone.level), atr),
        },
        nearest_resistance: LiquidityZoneItem {
            top: nearest_resistance.as_ref().map(|zone| zone.top),
            bottom: nearest_resistance.as_ref().map(|zone| zone.bottom),
            level: nearest_resistance.as_ref().map(|zone| zone.level),
            age_bars: nearest_resistance
                .as_ref()
                .map(|zone| last_index - zone.start_index),
            hit_count: nearest_resistance.as_ref().map(|zone| zone.hit_count),
            distance_atr: safe_divide(
                nearest_resistance.as_ref().map(|zone| zone.level - price),
                atr,
            ),
        },
        active_retest_direction: if support_retest {
            Some("LONG")
        } else if resistance_retest {
            Some("SHORT")
        } else {
            None
        },
        retest_penetration_pct: match (retest_penetration, retest_height) {
            (Some(penetration), Some(height)) if height > 0.0 => {
                Some((penetration / height) * 100.0)
            }
            _ => None,
        },
        crossed_above: previous_price.and_then(|previous| {
            nearest_resistance
                .as_ref()
                .map(|zone| previous <= zone.level && price > zone.level)
        }),
        crossed_below: previous_price.and_then(|previous| {
            nearest_support
                .as_ref()
                .map(|zone| previous >= zone.level && price < zone.level)
        }),
    }
}

fn empty_tail_item() -> LiquidityTailItem {
    LiquidityTailItem {
        top: None,
        bottom: None,
        mid: None,
        touches: None,
        age_bars: None,
        distance_atr: None,
    }
}

fn build_liquidity_tails_context(
    candles: &[NativeCandle],
    price: f64,
    atr: Option<f64>,
) -> LiquidityTailsContext {
    let empty = || LiquidityTailsContext {
        active_count: 0,
        nearest_buy_pressure: empty_tail_item(),
        nearest_sell_pressure: empty_tail_item(),
        current_tail: CurrentTail {
            side: None,
            wick_atr: None,
            wick_body_ratio: None,
            dominance: None,
        },
        active_retest_direction: None,
    };
    if candles.is_empty() {
        return empty();
    }

    let atr_series = calculate_atr_series(candles, LIQUIDITY_TAIL_ATR_LENGTH);
    let mut zones: Vec<LiquidityTailZoneSnapshot> = Vec::new();
    let mut last_fire_index: isize = isize::MIN / 2;
    for (index, candle) in candles.iter().enumerate() {
        let atr_at_index = atr_series[index];
        let top_shadow = candle.high - candle.open.max(candle.close);
        let bottom_shadow = candle.open.min(candle.close) - candle.low;
        let body = (candle.close - candle.open).abs().max(1e-9);
        let can_fire = atr_at_index.is_some()
            && (index as isize - last_fire_index) > LIQUIDITY_TAIL_MIN_GAP as isize;
        let sell_fire = can_fire
            && top_shadow >= LIQUIDITY_TAIL_ATR_MULT * atr_at_index.unwrap()
            && top_shadow >= LIQUIDITY_TAIL_MIN_WICK_RATIO * body
            && top_shadow > bottom_shadow * LIQUIDITY_TAIL_WICK_DOMINANCE;
        let buy_fire = can_fire
            && bottom_shadow >= LIQUIDITY_TAIL_ATR_MULT * atr_at_index.unwrap()
            && bottom_shadow >= LIQUIDITY_TAIL_MIN_WICK_RATIO * body
            && bottom_shadow > top_shadow * LIQUIDITY_TAIL_WICK_DOMINANCE;

        if sell_fire {
            last_fire_index = index as isize;
            let top = candle.high;
            let bottom = candle.open.max(candle.close);
            zones.push(LiquidityTailZoneSnapshot {
                kind: "sell_pressure",
                top,
                bottom,
                mid: (top + bottom) / 2.0,
                start_index: index,
                touches: 0,
                spent: false,
            });
        } else if buy_fire {
            last_fire_index = index as isize;
            let top = candle.open.min(candle.close);
            let bottom = candle.low;
            zones.push(LiquidityTailZoneSnapshot {
                kind: "buy_pressure",
                top,
                bottom,
                mid: (top + bottom) / 2.0,
                start_index: index,
                touches: 0,
                spent: false,
            });
        }

        for zone in zones.iter_mut() {
            if index <= zone.start_index || zone.spent {
                continue;
            }
            let broken = if zone.kind == "sell_pressure" {
                candle.low >= zone.top
            } else {
                candle.high <= zone.bottom
            };
            if broken {
                zone.spent = true;
                continue;
            }
            let entry = if zone.kind == "sell_pressure" {
                zone.bottom
            } else {
                zone.top
            };
            let in_zone = if zone.kind == "sell_pressure" {
                candle.high >= entry
            } else {
                candle.low <= entry
            };
            if in_zone {
                zone.touches += 1;
            }
        }
    }

    let last_index = candles.len() - 1;
    let current = &candles[last_index];
    let active_zones: Vec<LiquidityTailZoneSnapshot> = zones
        .into_iter()
        .filter(|zone| !zone.spent && last_index - zone.start_index <= LIQUIDITY_TAIL_MAX_AGE)
        .collect();
    let nearest_buy = active_zones
        .iter()
        .filter(|zone| zone.kind == "buy_pressure")
        .min_by(|left, right| {
            (price - left.mid)
                .abs()
                .partial_cmp(&(price - right.mid).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned();
    let nearest_sell = active_zones
        .iter()
        .filter(|zone| zone.kind == "sell_pressure")
        .min_by(|left, right| {
            (left.mid - price)
                .abs()
                .partial_cmp(&(right.mid - price).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned();

    let top_shadow = current.high - current.open.max(current.close);
    let bottom_shadow = current.open.min(current.close) - current.low;
    let body = (current.close - current.open).abs().max(1e-9);
    let active_retest_direction = if nearest_buy
        .as_ref()
        .map(|zone| current.low <= zone.top)
        .unwrap_or(false)
    {
        Some("LONG")
    } else if nearest_sell
        .as_ref()
        .map(|zone| current.high >= zone.bottom)
        .unwrap_or(false)
    {
        Some("SHORT")
    } else {
        None
    };
    let dominant_upper = top_shadow > bottom_shadow;
    let dominant_wick = if dominant_upper {
        top_shadow
    } else {
        bottom_shadow
    };
    let opposite_wick = if dominant_upper {
        bottom_shadow
    } else {
        top_shadow
    };

    LiquidityTailsContext {
        active_count: active_zones.len(),
        nearest_buy_pressure: LiquidityTailItem {
            top: nearest_buy.as_ref().map(|zone| zone.top),
            bottom: nearest_buy.as_ref().map(|zone| zone.bottom),
            mid: nearest_buy.as_ref().map(|zone| zone.mid),
            touches: nearest_buy.as_ref().map(|zone| zone.touches),
            age_bars: nearest_buy
                .as_ref()
                .map(|zone| last_index - zone.start_index),
            distance_atr: safe_divide(nearest_buy.as_ref().map(|zone| price - zone.mid), atr),
        },
        nearest_sell_pressure: LiquidityTailItem {
            top: nearest_sell.as_ref().map(|zone| zone.top),
            bottom: nearest_sell.as_ref().map(|zone| zone.bottom),
            mid: nearest_sell.as_ref().map(|zone| zone.mid),
            touches: nearest_sell.as_ref().map(|zone| zone.touches),
            age_bars: nearest_sell
                .as_ref()
                .map(|zone| last_index - zone.start_index),
            distance_atr: safe_divide(nearest_sell.as_ref().map(|zone| zone.mid - price), atr),
        },
        current_tail: CurrentTail {
            side: if dominant_wick <= 0.0 {
                None
            } else if dominant_upper {
                Some("upper")
            } else {
                Some("lower")
            },
            wick_atr: safe_divide(Some(dominant_wick), atr),
            wick_body_ratio: safe_divide(Some(dominant_wick), Some(body)),
            dominance: safe_divide(
                Some(dominant_wick),
                if opposite_wick == 0.0 {
                    None
                } else {
                    Some(opposite_wick)
                },
            ),
        },
        active_retest_direction,
    }
}

fn calculate_linreg_now(values: &[f64], index: usize, period: usize) -> Option<f64> {
    let start = index.checked_add(1)?.checked_sub(period)?;
    let x_mean = (period - 1) as f64 / 2.0;
    let mut y_sum = 0.0;
    let mut numerator = 0.0;
    let mut denominator = 0.0;
    for x in 0..period {
        let value = values[start + x];
        y_sum += value;
        numerator += (x as f64 - x_mean) * value;
        denominator += (x as f64 - x_mean).powi(2);
    }
    let y_mean = y_sum / period as f64;
    let slope = if denominator == 0.0 {
        0.0
    } else {
        numerator / denominator
    };
    let intercept = y_mean - slope * x_mean;
    Some(intercept + slope * (period - 1) as f64)
}

fn build_adaptive_trend_channel_context(
    candles: &[NativeCandle],
    price: f64,
) -> AdaptiveChannelContext {
    let empty = || AdaptiveChannelContext {
        centerline: None,
        upper: None,
        lower: None,
        direction: "unknown",
        regime: "unknown",
        roof: None,
        floor: None,
        flip_up: None,
        flip_down: None,
        half_channel_atr: None,
        centerline_slope: None,
        channel_width_atr: None,
        price_position_in_channel: None,
    };
    let start = candles.len().saturating_sub(ADAPTIVE_CHANNEL_CALC_LOOKBACK);
    let window = &candles[start..];
    if window.len() <= ADAPTIVE_CHANNEL_REGRESSION_BARS {
        return empty();
    }

    let highs: Vec<f64> = window.iter().map(|candle| candle.high).collect();
    let lows: Vec<f64> = window.iter().map(|candle| candle.low).collect();
    let closes: Vec<f64> = window.iter().map(|candle| candle.close).collect();
    let mut reg_high = vec![None; window.len()];
    let mut reg_low = vec![None; window.len()];
    let mut reg_close = vec![None; window.len()];
    let mut regime: Option<i32> = None;
    let mut previous_regime: Option<i32> = None;
    let mut centerline: Option<f64> = None;
    let mut previous_centerline: Option<f64> = None;
    let mut bull_support_trail = window[0].low;
    let mut bear_resistance_trail = window[0].high;

    for index in 0..window.len() {
        reg_high[index] = calculate_linreg_now(&highs, index, ADAPTIVE_CHANNEL_REGRESSION_BARS);
        reg_low[index] = calculate_linreg_now(&lows, index, ADAPTIVE_CHANNEL_REGRESSION_BARS);
        reg_close[index] = calculate_linreg_now(&closes, index, ADAPTIVE_CHANNEL_REGRESSION_BARS);

        let envelope_start = (index + 1).saturating_sub(ADAPTIVE_CHANNEL_ENVELOPE_BARS);
        let mut high_count = 0usize;
        let mut low_count = 0usize;
        let mut high_sum = 0.0;
        let mut low_sum = 0.0;
        let mut window_peak = f64::NEG_INFINITY;
        let mut window_trough = f64::INFINITY;
        for cursor in envelope_start..=index {
            if let Some(value) = reg_high[cursor] {
                high_count += 1;
                high_sum += value;
                window_peak = window_peak.max(value);
            }
            if let Some(value) = reg_low[cursor] {
                low_count += 1;
                low_sum += value;
                window_trough = window_trough.min(value);
            }
        }
        if high_count < ADAPTIVE_CHANNEL_ENVELOPE_BARS || low_count < ADAPTIVE_CHANNEL_ENVELOPE_BARS
        {
            continue;
        }

        let upper_reaction = high_sum / high_count as f64;
        let lower_reaction = low_sum / low_count as f64;
        let previous_reg_low = if index > 0 { reg_low[index - 1] } else { None };
        let previous_reg_high = if index > 0 { reg_high[index - 1] } else { None };
        let current_reg_close = reg_close[index];

        previous_regime = regime;
        previous_centerline = centerline;
        if regime.is_none() && index > ADAPTIVE_CHANNEL_REGRESSION_BARS {
            regime = Some(1);
            centerline = Some(window_trough);
        } else if regime == Some(1) {
            bull_support_trail = bull_support_trail.max(window_trough);
            if upper_reaction < bull_support_trail
                && current_reg_close.is_some()
                && previous_reg_low.is_some()
                && current_reg_close.unwrap() < previous_reg_low.unwrap()
            {
                regime = Some(-1);
                centerline = Some(window_peak);
                bear_resistance_trail = reg_high[index].unwrap_or(window[index].high);
            }
        } else if regime == Some(-1) {
            bear_resistance_trail = bear_resistance_trail.min(window_peak);
            if lower_reaction > bear_resistance_trail
                && current_reg_close.is_some()
                && previous_reg_high.is_some()
                && current_reg_close.unwrap() > previous_reg_high.unwrap()
            {
                regime = Some(1);
                centerline = Some(window_trough);
                bull_support_trail = reg_low[index].unwrap_or(window[index].low);
            }
        }

        if regime == Some(1) {
            centerline = Some(centerline.unwrap_or(window_trough).max(window_trough));
        } else if regime == Some(-1) {
            centerline = Some(centerline.unwrap_or(window_peak).min(window_peak));
        }
    }

    let last_index = window.len() - 1;
    let atr100 = calculate_atr_at(
        window,
        last_index,
        ADAPTIVE_CHANNEL_VOLATILITY_LOOKBACK.min(window.len()),
    );
    let half_channel = atr100.map(|value| ADAPTIVE_CHANNEL_ATR_STRETCH * value * 0.5);
    let roof = match (centerline, half_channel) {
        (Some(center), Some(half)) => Some(center + half),
        _ => None,
    };
    let floor = match (centerline, half_channel) {
        (Some(center), Some(half)) => Some(center - half),
        _ => None,
    };
    let centerline_slope = match (centerline, previous_centerline) {
        (Some(center), Some(previous)) => Some(center - previous),
        _ => None,
    };
    let regime_text = match regime {
        Some(1) => "bull",
        Some(-1) => "bear",
        _ => "unknown",
    };
    let direction = match centerline_slope {
        Some(value) if value > 0.0 => "bull",
        Some(value) if value < 0.0 => "bear",
        Some(_) => "neutral",
        None => regime_text,
    };

    AdaptiveChannelContext {
        centerline,
        upper: roof,
        lower: floor,
        direction,
        regime: regime_text,
        roof,
        floor,
        flip_up: Some(previous_regime == Some(-1) && regime == Some(1)),
        flip_down: Some(previous_regime == Some(1) && regime == Some(-1)),
        half_channel_atr: safe_divide(half_channel, atr100),
        centerline_slope,
        channel_width_atr: safe_divide(half_channel.map(|value| value * 2.0), atr100),
        price_position_in_channel: match (floor, roof) {
            (Some(low), Some(high)) => calculate_range_position(price, low, high),
            _ => None,
        },
    }
}

fn build_trend_follow_context(
    candles: &[NativeCandle],
    price: f64,
    atr: Option<f64>,
) -> TrendFollowContext {
    let mut trend_state = 0i32;
    let mut last_pivot_high: Option<f64> = None;
    let mut last_pivot_low: Option<f64> = None;
    let mut last_signal_index: Option<usize> = None;
    let mut last_signal_direction: Option<&'static str> = None;
    let mut trail_stop: Option<f64> = None;
    let mut breakout_confirmed: Option<bool> = None;
    let atr_series = calculate_atr_series(candles, TREND_FOLLOW_ATR_LENGTH);

    for index in 0..candles.len() {
        let candidate_index = index.saturating_sub(TREND_FOLLOW_PIVOT_LENGTH);
        if index >= TREND_FOLLOW_PIVOT_LENGTH && candidate_index >= TREND_FOLLOW_PIVOT_LENGTH {
            if is_confirmed_pivot_high(candles, candidate_index, TREND_FOLLOW_PIVOT_LENGTH) {
                last_pivot_high = Some(candles[candidate_index].high);
            }
            if is_confirmed_pivot_low(candles, candidate_index, TREND_FOLLOW_PIVOT_LENGTH) {
                last_pivot_low = Some(candles[candidate_index].low);
            }
        }

        let candle = &candles[index];
        let current_atr = atr_series[index].or(atr);
        let previous = index.checked_sub(1).and_then(|idx| candles.get(idx));
        let bull_cross = previous.is_some()
            && last_pivot_high.is_some()
            && previous.unwrap().close <= last_pivot_high.unwrap()
            && candle.close > last_pivot_high.unwrap()
            && trend_state != 1;
        let bear_cross = previous.is_some()
            && last_pivot_low.is_some()
            && previous.unwrap().close >= last_pivot_low.unwrap()
            && candle.close < last_pivot_low.unwrap()
            && trend_state != -1;

        if bull_cross {
            trend_state = 1;
            trail_stop = current_atr.map(|value| candle.close - value * TREND_FOLLOW_ATR_MULT);
            last_signal_index = Some(index);
            last_signal_direction = Some("LONG");
            breakout_confirmed = Some(true);
        } else if bear_cross {
            trend_state = -1;
            trail_stop = current_atr.map(|value| candle.close + value * TREND_FOLLOW_ATR_MULT);
            last_signal_index = Some(index);
            last_signal_direction = Some("SHORT");
            breakout_confirmed = Some(true);
        } else if trend_state == 1 && current_atr.is_some() {
            let new_stop = candle.close - current_atr.unwrap() * TREND_FOLLOW_ATR_MULT;
            trail_stop = Some(trail_stop.unwrap_or(new_stop).max(new_stop));
        } else if trend_state == -1 && current_atr.is_some() {
            let new_stop = candle.close + current_atr.unwrap() * TREND_FOLLOW_ATR_MULT;
            trail_stop = Some(trail_stop.unwrap_or(new_stop).min(new_stop));
        }
    }

    TrendFollowContext {
        state: if trend_state == 1 {
            "bull"
        } else if trend_state == -1 {
            "bear"
        } else {
            "neutral"
        },
        last_signal_direction,
        signal_age_bars: last_signal_index.map(|index| candles.len() - 1 - index),
        trail_stop,
        distance_to_trail_stop_atr: safe_divide(trail_stop.map(|value| price - value), atr),
        distance_to_trail_stop_pct: trail_stop.and_then(|value| {
            if price == 0.0 {
                None
            } else {
                Some(((price - value) / price) * 100.0)
            }
        }),
        last_pivot_high,
        last_pivot_low,
        breakout_confirmed,
    }
}

fn build_delta_context(candles: &[NativeCandle]) -> DeltaContext {
    let has_taker_volume = candles.iter().any(|item| {
        item.taker_buy_base_volume
            .is_some_and(|value| value.is_finite())
    });
    let signed_volumes: Vec<f64> = candles
        .iter()
        .map(|item| {
            if let Some(buy_volume) = item.taker_buy_base_volume.filter(|value| value.is_finite()) {
                let sell_volume = item
                    .taker_sell_base_volume
                    .filter(|value| value.is_finite())
                    .unwrap_or_else(|| (item.volume - buy_volume).max(0.0));
                return buy_volume - sell_volume;
            }

            let range = item.high - item.low;
            let buy_pressure_pct = if range > 0.0 {
                (item.close - item.low) / range
            } else if item.close >= item.open {
                1.0
            } else {
                0.0
            };
            (buy_pressure_pct * 2.0 - 1.0) * item.volume
        })
        .collect();

    let latest = candles.last();
    let latest_range = latest.map(|item| item.high - item.low);
    let latest_buy_volume =
        latest.and_then(|item| item.taker_buy_base_volume.filter(|value| value.is_finite()));
    let latest_sell_volume = match (latest, latest_buy_volume) {
        (Some(item), Some(buy_volume)) => item
            .taker_sell_base_volume
            .filter(|value| value.is_finite())
            .or_else(|| Some((item.volume - buy_volume).max(0.0))),
        _ => None,
    };
    let buy_pressure_pct = match (latest_buy_volume, latest_sell_volume) {
        (Some(buy), Some(sell)) => safe_divide(Some(buy), Some(buy + sell)),
        _ => match (latest, latest_range) {
            (Some(item), Some(range)) if range > 0.0 => Some((item.close - item.low) / range),
            _ => None,
        },
    };
    let signed_volume = signed_volumes.last().copied();
    let delta_slope = calculate_line_slope(&signed_volumes, 5);
    let closes: Vec<f64> = candles.iter().map(|item| item.close).collect();
    let price_slope = calculate_line_slope(&closes, 5);
    let delta_divergence_vs_price = match (price_slope, delta_slope) {
        (Some(price_value), Some(delta_value)) if price_value > 0.0 && delta_value < 0.0 => {
            "bearish"
        }
        (Some(price_value), Some(delta_value)) if price_value < 0.0 && delta_value > 0.0 => {
            "bullish"
        }
        (Some(_), Some(_)) => "none",
        _ => "unknown",
    };

    DeltaContext {
        source: if has_taker_volume {
            "kline_taker_volume"
        } else {
            "ohlcv_proxy"
        },
        buy_pressure_pct,
        buy_volume: latest_buy_volume,
        sell_volume: latest_sell_volume,
        net_delta: match (latest_buy_volume, latest_sell_volume) {
            (Some(buy), Some(sell)) => Some(buy - sell),
            _ => signed_volume,
        },
        delta_pct: match (latest_buy_volume, latest_sell_volume) {
            (Some(buy), Some(sell)) => safe_divide(Some(buy - sell), Some(buy + sell)),
            _ => None,
        },
        signed_volume,
        signed_volume_z_score: calculate_z_score(&signed_volumes, signed_volume),
        delta_slope,
        delta_divergence_vs_price,
    }
}

#[napi]
pub fn build_base_context_overlay_json(
    candles: Vec<NativeCandle>,
    price: f64,
    previous_price: Option<f64>,
    atr: Option<f64>,
) -> napi::Result<String> {
    let structure_start = candles.len().saturating_sub(80);
    let structure_window = &candles[structure_start..];
    let liquidity_start = candles.len().saturating_sub(180);
    let liquidity_window = &candles[liquidity_start..];
    let trend_start = candles.len().saturating_sub(220);
    let trend_window = &candles[trend_start..];
    let overlay = NativeOverlay {
        volume_structure: build_volume_structure_context(&candles, price, atr.and_then(finite)),
        sr_zones: build_sr_zones_context(
            structure_window,
            price,
            previous_price.and_then(finite),
            atr.and_then(finite),
        ),
        liquidity_zones: build_liquidity_zones_context(
            liquidity_window,
            price,
            previous_price.and_then(finite),
            atr.and_then(finite),
        ),
        liquidity_tails: build_liquidity_tails_context(
            liquidity_window,
            price,
            atr.and_then(finite),
        ),
        trend_follow: build_trend_follow_context(trend_window, price, atr.and_then(finite)),
        adaptive_channel: build_adaptive_trend_channel_context(&candles, price),
        delta: build_delta_context(structure_window),
    };

    serde_json::to_string(&overlay).map_err(|error| {
        napi::Error::from_reason(format!("native overlay serialization failed: {error}"))
    })
}
