use napi::bindgen_prelude::{Float64Array, Int32Array};
use napi_derive::napi;

/// Stops execute before every target. Targets retain their submission order.
#[napi]
pub fn match_exits(
    long: bool,
    high: f64,
    low: f64,
    stop: f64,
    targets: Float64Array,
) -> Int32Array {
    if stop != 0.0 && !stop.is_nan() && if long { low <= stop } else { high >= stop } {
        return Int32Array::new(vec![-1]);
    }
    let hits = targets
        .iter()
        .enumerate()
        .filter_map(|(index, &price)| {
            let hit = if long { high >= price } else { low <= price };
            hit.then_some(index as i32)
        })
        .collect();
    Int32Array::new(hits)
}

#[napi]
pub fn net_profit(gross_profit: f64, price: f64, qty: f64, fee_rate: f64) -> Float64Array {
    let fee = price * qty * fee_rate;
    Float64Array::new(vec![fee, gross_profit - fee])
}

#[napi]
pub fn align_timestamps(left: Float64Array, right: Float64Array) -> Int32Array {
    let mut pairs = Vec::with_capacity(2 * left.len().min(right.len()));
    let (mut i, mut j) = (0, 0);
    while i < left.len() && j < right.len() {
        if left[i] == right[j] {
            pairs.extend([i as i32, j as i32]);
            i += 1;
            j += 1;
        } else if left[i] < right[j] {
            i += 1;
        } else {
            j += 1;
        }
    }
    Int32Array::new(pairs)
}

/// Pearson correlation of paired close returns on each trailing candle window.
/// The caller supplies aligned, finite close series. Values use only the prefix
/// ending at their own bar, and the caller applies TradeJS rounding.
#[napi]
pub fn rolling_correlation(
    coin: Float64Array,
    btc: Float64Array,
    window: u32,
) -> napi::Result<Float64Array> {
    let window = window as usize;
    if coin.len() != btc.len() || window <= 10 {
        return Err(napi::Error::from_reason(
            "Expected equal close series and a window greater than ten candles",
        ));
    }
    let returns = |prices: &[f64]| {
        prices
            .windows(2)
            .map(|pair| (pair[1] - pair[0]) / pair[0])
            .collect::<Vec<_>>()
    };
    let coin_returns = returns(&coin);
    let btc_returns = returns(&btc);
    let mut values = vec![0.0; coin.len()];
    for (end, result) in values.iter_mut().enumerate().skip(10) {
        let start = (end + 1).saturating_sub(window);
        let left = &coin_returns[start..end];
        let right = &btc_returns[start..end];
        let n = left.len() as f64;
        let left_mean = left.iter().fold(0.0, |sum, &value| sum + value) / n;
        let right_mean = right.iter().fold(0.0, |sum, &value| sum + value) / n;
        let (mut covariance, mut left_variance, mut right_variance) = (0.0, 0.0, 0.0);
        for (&x, &y) in left.iter().zip(right) {
            let dx = x - left_mean;
            let dy = y - right_mean;
            covariance += dx * dy;
            left_variance += dx * dx;
            right_variance += dy * dy;
        }
        if left_variance != 0.0 && right_variance != 0.0 {
            *result = covariance / (left_variance * right_variance).sqrt();
        }
    }
    Ok(Float64Array::new(values))
}
