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
