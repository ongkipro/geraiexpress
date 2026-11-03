# Official Cargo Contract Excerpts

Retrieved: 2026-11-03. Quoted public-source text only; not account-specific runtime proof.

## Public API — https://api-public.mengantar.com/docs/

### 3PL and minimum weight

## Check Shipping Fee 3PL

                `# Here is a curl example curl -X GET '{BASE_URL}/api/order/allEstimate3PL?origin_id=5fc62de8f8f44b34aa4bdc49&destination_id=5fc64922f8f44b34aa4ce896&weight=1&isDangerousGoods=true'`
                
            

GET `{BASE_URL}/api/order/allEstimate3PL`

**3PL (Third Party Logistics) Endpoint:** Standarized price Mengantar without any special promo or discount. Ideal for logistics partners and integrators who need raw courier rates but still using Mengantar.

  

```

Result example :
{
    "success": true,
    "data": {
        "JNE": {
            "unsupported": null,
            "unsupported_cod": null,
            "price": 14000,
            "estimatedDate": "1 - 2 days",
            "isDangerousGoodsSupported": false
        },
        "SiCepat": {
            "unsupported": false,
            "unsupported_cod": false,
            "price": 18000,
            "estimatedDate": "3 - 4 days",
            "isDangerousGoodsSupported": true
        }
        ...otherCouriers
    }
}
                
```

#### QUERY PARAMETERS

Field

Type

Description

origin\_id

String

\_id of address data from this route `/address/search`

destination\_id

String

\_id of address data from this route `/address/search`

weight

Number

(default: 1). Unit in kg(kilogram)

isDangerousGoods

Boolean

(Optional, default: `false`). Use `true` or `1` to return DG rates, coverage, and `isDangerousGoodsSupported` for every courier.

⚠ **Notes**

*   **No Flat Pricing** — prices are raw courier rates without Mengantar markup or discount.
*   **Ninja (discontinued 1 September 2026)** — `Ninja`, `NinjaCargo` are omitted from the response.
*   Possibilities for **unsupported** and **unsupported\_cod**:
    *   if unsupported `true` and unsupported\_cod `true` — CAN'T send to destination BOTH COD AND NON COD
    *   if unsupported `true` and unsupported\_cod `false` — CAN'T send to destination BOTH COD AND NON COD
    *   if unsupported `false` and unsupported\_cod `true` — can't send COD BUT still CAN send Non COD
    *   if unsupported `false` and unsupported\_cod `false` — can send COD or Non COD
*   **minimumWeightCargo** is shown only for couriers that support cargo shipments — indicates the minimum weight recommended for cargo orders.
*   For DG requests, supported regular couriers are **SiCepat, SAP, IDExpress, and J&T**. `isDangerousGoodsSupported` is omitted when `isDangerousGoods` is false or not provided.
*   Courier capability does not guarantee destination coverage; check `unsupported` before creating an order.
*   **SPX Express (spx) limits:** maximum weight **50 kg**, maximum COD amount **Rp5,000,000**, maximum Non-COD goods value **Rp10,000,000**.



### Cargo order field

orders.cargo

Boolean

(Optional) if true then it will proceed with Cargo type. Couriers that have cargo option: (JNE, SiCepat, Sap, iDexpress)



### Dangerous goods incompatibility

#### Dangerous Goods

Before creating a DG order, call a shipping estimate endpoint with `isDangerousGoods=true`. Proceed only when `isDangerousGoodsSupported` is `true` and `unsupported` is `false`.

Courier

Create Order DG

Service

SiCepat

`true`

`HALU`

IDExpress (`iDexpress`)

`true`

Regular service

**Validation errors return HTTP 400:**

```
{
  "success": false,
  "message": "orders[0].isDangerousGoods must be a boolean"
}
```

*   `Dangerous goods cannot be combined with cargo service`
*   `Dangerous goods service is not supported by courier {courier}`
*   `Dangerous goods service is not available for destination of orders[{index}]`



## Courier help — https://help.mengantar.com/id/articles/5502313-jne-sicepat-sap-idexpress-jandt-lion-parcel-anteraja-pos-ind-dan-spx

Source updated: 2026-09-24.

## 🚚 Layanan kargo

Layanan kargo bisa Kamu pilih jika ingin mengirim paket berukuran besar. Dengan layanan kargo, Kamu juga bisa menghemat biaya pengiriman karena tarif yang lebih kompetitif untuk barang berat. Selain itu ada berbagai pilihan pengiriman yang dapat disesuaikan dengan kebutuhan, baik itu pengiriman darat, laut, maupun udara. Berikut adalah rincian batas berat paket di layanan kargo dari beberapa penyedia jasa ekspedisi:

-   **JTR** : Minimal 10Kg, Maksimal 30Kg
    
-   **SiCepat Gokil** : Minimal 10Kg, Maksimal 50Kg
    
-   **SAP Kargo** berlaku minimal berat paket berdasarkan wilayah pengiriman dan hanya tersedia untuk pengiriman Non COD.
    
    a. Kota Asal - Pulau Jawa, dengan tujuan:
    
    -   _Intercity_ - Minimal 5Kg (Contoh : dari Surabaya ke Surabaya - selama pengiriman masih dalam satu kota yang sama, masuk kategori _Intercity_).
        
    -   Pulau Jawa dan Bali - Minimal 5Kg
        
    -   Pulau Sumatera dan NTB - Minimal 50Kg
        
    -   Pulau Kalimantan, Sulawesi, Indonesia Timur - Minimal 100Kg
        
    
    b. Kota Asal - Pulau Sumatera, dengan tujuan:
    
    -   _Intercity_ - Minimal 10Kg (Contoh : Medan - Medan - selama pengiriman masih dalam satu kota yang sama, masuk kategori _Intercity_).
        
    -   Pulau Sumatera, Jawa, Bali, NTB - Minimal 50Kg
        
    -   Kalimantan, Sulawesi, Indonesia Timur - Minimal 100Kg
        
    
    c. Kota Asal - Pulau Kalimantan, dengan tujuan:
    
    -   _Intercity_ - Minimal 10Kg
        
    -   Pulau Kalimantan - Minimal 50Kg
        
    -   Selain Pulau Kalimantan - Minimal 100Kg
        
    
    d. Kota Asal - Pulau Sulawesi, dengan tujuan:
    
    -   _Intercity_ - Minimal 10Kg
        
    -   Pulau Sulawesi - Minimal 50Kg
        
    -   Selain Pulau Sulawesi - Minimal 100Kg
        
    
    e. Kota Asal - Pulau Indonesia Timur, dengan tujuan:
    
    -   _Intercity_ - Minimal 10Kg
        
    -   Indonesia Timur, Jawa, Bali, NTB, Sumatera, Kalimantan - Minimal 100Kg
        
    
    f. Kota Asal - Pulau Bali dan NTB, dengan tujuan:
    
    -   _Intercity_ - Minimal 5Kg
        
    -   Jawa, Bali, NTB, - Minimal 10Kg
        
    -   Selain Jawa, Bali, NTB, - Minimal 100Kg
        
    
-   **IDX Kargo** : Minimal 10Kg, Maksimal 70 Kg
    
    IDX kargo menjangkau pengiriman ke **Jawa**, **Bali** dan **Sumatera**. Wilayah **Kalimantan** hanya berlaku pengiriman **dari Kalimantan ke Kalimantan**.


