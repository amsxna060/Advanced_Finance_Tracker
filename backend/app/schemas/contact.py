from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ContactCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    alternate_phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    contact_type: str = "individual"
    relationship_type: str = "borrower"
    is_handshake: bool = False
    notes: Optional[str] = None


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    alternate_phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    contact_type: Optional[str] = None
    relationship_type: Optional[str] = None
    is_handshake: Optional[bool] = None
    notes: Optional[str] = None


class ContactOut(BaseModel):
    id: int
    name: str
    phone: Optional[str]
    alternate_phone: Optional[str]
    address: Optional[str]
    city: Optional[str]
    contact_type: str
    relationship_type: str
    is_handshake: bool
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
