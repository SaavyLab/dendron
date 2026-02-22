//! Tauri commands for exporting query results

use dendron_core::db::postgres::QueryResult;

#[tauri::command]
pub fn export_csv(results: QueryResult) -> Result<String, String> {
    if results.rows.is_empty() {
        return Err("No results to export".to_string());
    }

    let mut wtr = csv::Writer::from_writer(vec![]);

    // Write header
    wtr.write_record(&results.columns).map_err(|e| e.to_string())?;

    // Write rows
    for row in &results.rows {
        wtr.write_record(row).map_err(|e| e.to_string())?;
    }

    wtr.flush().map_err(|e| e.to_string())?;
    let data = wtr.into_inner().map_err(|e| e.to_string())?;
    String::from_utf8(data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_json(results: QueryResult) -> Result<String, String> {
    if results.rows.is_empty() {
        return Err("No results to export".to_string());
    }

    let records: Vec<serde_json::Map<String, serde_json::Value>> = results.rows.iter().map(|row| {
        let mut map = serde_json::Map::new();
        for (col, val) in results.columns.iter().zip(row.iter()) {
            let json_val = if val == "NULL" {
                serde_json::Value::Null
            } else if let Ok(n) = val.parse::<i64>() {
                serde_json::Value::Number(n.into())
            } else if let Ok(n) = val.parse::<f64>() {
                serde_json::json!(n)
            } else if val == "true" || val == "false" {
                serde_json::Value::Bool(val == "true")
            } else {
                serde_json::Value::String(val.clone())
            };
            map.insert(col.clone(), json_val);
        }
        map
    }).collect();

    serde_json::to_string_pretty(&records).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_row_as_insert(
    table: String,
    row: Vec<String>,
    columns: Vec<String>,
) -> Result<String, String> {
    if row.len() != columns.len() {
        return Err("Row and column count mismatch".to_string());
    }

    let col_list = columns.join(", ");
    let val_list: Vec<String> = row.iter().map(|v| {
        if v == "NULL" {
            "NULL".to_string()
        } else {
            // Escape single quotes
            format!("'{}'", v.replace('\'', "''"))
        }
    }).collect();

    Ok(format!("INSERT INTO {} ({}) VALUES ({});", table, col_list, val_list.join(", ")))
}

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}
